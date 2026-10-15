import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('metrics_parser', Path(__file__).with_name('parser.py'))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class MetricsTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.multiple(parser, SONAR_TOKEN='test-only', GITHUB_TOKEN='test-only',
                                  SONAR_BRANCH='main', EXPECTED_SHA='a' * 40,
                                  REPO='2026-2-AnatoQuizUp-BFF', SONAR_WAIT_SECONDS=0)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.analysis = {'key': 'analysis-1', 'revision': parser.EXPECTED_SHA}

    def test_waits_for_exact_revision_and_checks_gate(self):
        with patch.object(parser, 'latest_analysis', return_value=self.analysis), \
             patch.object(parser, 'sonar_get', return_value={'projectStatus': {'status': 'OK'}}):
            self.assertEqual(parser.wait_for_analysis('project'), self.analysis)

    def test_old_revision_is_not_exported(self):
        with patch.object(parser, 'latest_analysis', return_value={'revision': 'old'}):
            with self.assertRaisesRegex(RuntimeError, 'prazo'):
                parser.wait_for_analysis('project')

    def test_failed_gate_blocks_collection(self):
        with patch.object(parser, 'latest_analysis', return_value=self.analysis), \
             patch.object(parser, 'sonar_get', return_value={'projectStatus': {'status': 'ERROR'}}):
            with self.assertRaisesRegex(RuntimeError, 'Quality Gate'):
                parser.wait_for_analysis('project')

    def test_missing_branch_or_commit_is_rejected(self):
        with patch.object(parser, 'EXPECTED_SHA', ''):
            with self.assertRaisesRegex(RuntimeError, 'EXPECTED_SHA'):
                parser.wait_for_analysis('project')

    def export(self, *, missing=False, changed=False):
        measures = [{'metric': key, 'value': '0'} for key in parser.METRICS_SONAR]
        if missing:
            measures = [item for item in measures if item['metric'] != 'tests']
        pages = []
        for number in range(2):
            response = Mock()
            response.json.return_value = {
                'baseComponent': {'key': 'project'},
                'components': [{'key': f'file-{number}'}],
                'paging': {'total': 2, 'pageSize': 1},
            }
            pages.append(response)
        with patch.object(parser, 'wait_for_analysis', return_value=self.analysis), \
             patch.object(parser.requests, 'get', side_effect=pages) as get, \
             patch.object(parser, 'sonar_get', return_value={'component': {'measures': measures}}), \
             patch.object(parser, 'latest_analysis', return_value={'key': 'other'} if changed else self.analysis):
            parser.save_sonar_metrics('v1.2.0')
            self.assertEqual(get.call_count, 2)
            self.assertEqual(get.call_args.kwargs['params']['branch'], 'main')
            self.assertEqual(get.call_args.kwargs['params']['p'], 2)

    def in_temp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        original = os.getcwd()
        os.chdir(temp.name)
        self.addCleanup(os.chdir, original)

    def test_pagination_and_zero_measures_preserve_provenance(self):
        self.in_temp()
        self.export()
        files = list(Path('analytics-raw-data').glob('*.json'))
        self.assertEqual(len(files), 1)
        data = json.loads(files[0].read_text(encoding='utf-8'))
        self.assertEqual(len(data['components']), 2)
        self.assertEqual(len(data['project_measures']), 12)
        self.assertEqual(data['commit'], 'a' * 40)
        self.assertEqual(data['analysis']['key'], 'analysis-1')
        self.assertRegex(files[0].name, r'^fga-eps-mds-2026_2_UNB-AnatoQuizUp-BFF-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{2}-v1\.2\.0\.json$')

    def test_missing_test_metrics_do_not_write_json(self):
        self.in_temp()
        with self.assertRaisesRegex(RuntimeError, 'tests'):
            self.export(missing=True)
        self.assertFalse(Path('analytics-raw-data').exists())

    def test_analysis_changing_during_collection_is_rejected(self):
        self.in_temp()
        with self.assertRaisesRegex(RuntimeError, 'mudou'):
            self.export(changed=True)
        self.assertFalse(Path('analytics-raw-data').exists())

    def test_release_targets_analyzed_commit(self):
        response = Mock()
        response.json.return_value = {'upload_url': 'unused'}
        with patch.object(parser.requests, 'post', return_value=response) as post:
            parser.create_release('v2.0.0')
            self.assertEqual(post.call_args.kwargs['json']['target_commitish'], 'a' * 40)
            self.assertEqual(post.call_args.kwargs['json']['tag_name'], 'v2.0.0')

    def test_semver_increments(self):
        for flags, expected in [
            (('true', 'false', 'false'), 'v2.0.0'),
            (('false', 'true', 'false'), 'v1.3.0'),
            (('false', 'false', 'true'), 'v1.2.4'),
            (('false', 'false', 'false'), 'v1.2.3'),
        ]:
            with self.subTest(expected=expected), \
                 patch.object(parser, 'get_latest_release', return_value='v1.2.3'), \
                 patch.multiple(parser, RELEASE_MAJOR=flags[0], RELEASE_MINOR=flags[1], RELEASE_FIX=flags[2]):
                self.assertEqual(parser.new_tag_name(), expected)

    def test_failed_collection_never_creates_release(self):
        with patch.multiple(parser, RELEASE_MAJOR='true', RELEASE_MINOR='false', RELEASE_FIX='false'), \
             patch.object(parser, 'release_for_commit', return_value=None), \
             patch.object(parser, 'new_tag_name', return_value='v1.0.0'), \
             patch.object(parser, 'save_sonar_metrics', side_effect=RuntimeError('missing metrics')), \
             patch.object(parser, 'create_release') as create:
            with self.assertRaisesRegex(RuntimeError, 'missing metrics'):
                parser.main()
            create.assert_not_called()

    def test_manual_collection_does_not_create_release(self):
        with patch.multiple(parser, RELEASE_MAJOR='false', RELEASE_MINOR='false', RELEASE_FIX='false'), \
             patch.object(parser, 'get_latest_release', return_value='v1.0.0'), \
             patch.object(parser, 'save_sonar_metrics') as save, \
             patch.object(parser, 'save_github_metrics_runs'), \
             patch.object(parser, 'save_github_metrics_issues'), \
             patch.object(parser, 'create_release') as create:
            parser.main()
            save.assert_called_once_with('v1.0.0')
            create.assert_not_called()

    def test_rerun_reuses_release_for_same_commit(self):
        with patch.multiple(parser, RELEASE_MAJOR='true', RELEASE_MINOR='false', RELEASE_FIX='false'), \
             patch.object(parser, 'release_for_commit', return_value={'tag_name': 'v2.0.0'}), \
             patch.object(parser, 'save_sonar_metrics') as save, \
             patch.object(parser, 'save_github_metrics_runs'), \
             patch.object(parser, 'save_github_metrics_issues'), \
             patch.object(parser, 'create_release') as create:
            parser.main()
            save.assert_called_once_with('v2.0.0')
            create.assert_not_called()

    def test_conflicting_release_labels_are_rejected(self):
        with patch.multiple(parser, RELEASE_MAJOR='true', RELEASE_MINOR='true', RELEASE_FIX='false'):
            with self.assertRaisesRegex(RuntimeError, 'uma label'):
                parser.main()


if __name__ == '__main__':
    unittest.main()
