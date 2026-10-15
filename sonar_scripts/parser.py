import json
import requests
import time
from datetime import datetime, timezone
import os
from packaging import version
from dotenv import load_dotenv

######################################
# DECLARAÇÃO DE CONSTANTES/VARIÁVEIS #
######################################
TODAY = datetime.now(timezone.utc)

load_dotenv()
# Variáveis globais ao repositório
OWNER = "fga-eps-mds"
REPO = os.getenv('REPO')
REPO_ISSUES = os.getenv('REPO_DOC')

# Configurar as variáveis de ambiente
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')
SONAR_TOKEN = os.getenv('SONAR_TOKEN')
RELEASE_MAJOR = os.getenv('RELEASE_MAJOR')
RELEASE_MINOR = os.getenv('RELEASE_MINOR')
RELEASE_FIX = os.getenv('RELEASE_FIX')
DEVELOP = os.getenv('DEVELOP')
SONAR_BRANCH = os.getenv('SONAR_BRANCH', '')
EXPECTED_SHA = os.getenv('EXPECTED_SHA', '')
SONAR_WAIT_SECONDS = int(os.getenv('SONAR_WAIT_SECONDS', '900'))

METRICS_SONAR = [
    "files",
    "functions",
    "complexity",
    "comment_lines_density",
    "duplicated_lines_density",
    "coverage",
    "ncloc",
    "tests",
    "test_errors",
    "test_failures",
    "test_execution_time",
    "security_rating",
]

BASE_URL_SONAR = "https://sonarcloud.io/api/measures/component_tree?component=fga-eps-mds_"

# Utilize a api que for necessária
# api_url_workflows = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows"
# api_url_jobs = f"https://api.github.com/repos/{owner}/{repo}/actions/runs/3624383254/jobs"
# api_url_deployments = f"https://api.github.com/repos/{owner}/{repo}/deployments"
api_url_runs = f"https://api.github.com/repos/{OWNER}/{REPO}/actions/runs"
api_url_issues = f"https://api.github.com/repos/{OWNER}/{REPO_ISSUES}/issues"

###################
# FUNÇÕES RELEASE #
###################
# Pega a última release
def get_latest_release():
    url = f'https://api.github.com/repos/{OWNER}/{REPO}/releases'
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}'
    }
    response = requests.get(url, headers=headers, timeout=60)
    response.raise_for_status()
    releases = response.json()
    
    if releases:
        return releases[0].get('tag_name', '0.0.0')
    return '0.0.0'

# Cria um novo nome de tag
def new_tag_name():
    old_tag = get_latest_release()

    try:
        old_version = version.parse(old_tag.lstrip("v"))
    except version.InvalidVersion:
        old_version = version.parse("0.0.0")

    if RELEASE_MAJOR == "true":
        return f"v{old_version.major + 1}.0.0"

    if RELEASE_MINOR == "true":
        return f"v{old_version.major}.{old_version.minor + 1}.0"

    if RELEASE_FIX == "true":
        return f"v{old_version.major}.{old_version.minor}.{old_version.micro + 1}"

    return f"v{old_version}"
    
# Cria a nova release
def create_release(tag):
    url = f'https://api.github.com/repos/{OWNER}/{REPO}/releases'
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    payload = {
        'tag_name': tag,
        'name': tag,
        'target_commitish': EXPECTED_SHA,
        'body': f'Commit analisado: {EXPECTED_SHA}\nBranch: {SONAR_BRANCH}'
    }
    response = requests.post(url, headers=headers, json=payload, timeout=60)
    response.raise_for_status()
    res_data = response.json()
    return res_data.get('upload_url'), tag


def release_for_commit():
    response = requests.get(
        f'https://api.github.com/repos/{OWNER}/{REPO}/releases',
        headers={'Authorization': f'Bearer {GITHUB_TOKEN}'},
        params={'per_page': 100}, timeout=60,
    )
    response.raise_for_status()
    return next((release for release in response.json()
                 if release.get('target_commitish') == EXPECTED_SHA
                 and not release.get('draft')), None)

#################
# FUNÇÕES SONAR #
#################

def sonar_get(endpoint, **params):
    response = requests.get(
        f'https://sonarcloud.io/api/{endpoint}',
        auth=(SONAR_TOKEN, ''),
        params={'branch': SONAR_BRANCH, **params},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def latest_analysis(project_key):
    analyses = sonar_get('project_analyses/search', project=project_key, ps=1).get('analyses', [])
    return analyses[0] if analyses else {}


def wait_for_analysis(project_key):
    if not SONAR_TOKEN or not SONAR_BRANCH or not EXPECTED_SHA:
        raise RuntimeError('Configure SONAR_TOKEN, SONAR_BRANCH e EXPECTED_SHA antes da coleta.')
    deadline = time.monotonic() + SONAR_WAIT_SECONDS
    while True:
        analysis = latest_analysis(project_key)
        if analysis.get('revision') == EXPECTED_SHA:
            status = sonar_get('qualitygates/project_status', analysisId=analysis['key'])
            if status['projectStatus']['status'] != 'OK':
                raise RuntimeError('Quality Gate reprovado para o commit solicitado.')
            return analysis
        if time.monotonic() >= deadline:
            raise RuntimeError('O Sonar não publicou a análise do commit solicitado no prazo. Nenhuma métrica será atribuída a outra versão.')
        print(f'Aguardando análise de {SONAR_BRANCH} em {EXPECTED_SHA}...', flush=True)
        time.sleep(15)


def save_sonar_metrics(tag):
    if not SONAR_TOKEN:
        raise RuntimeError("SONAR_TOKEN não configurado.")

    project_key = f"fga-eps-mds_{REPO}"
    analysis = wait_for_analysis(project_key)
    url = "https://sonarcloud.io/api/measures/component_tree"

    auth = (SONAR_TOKEN, "")
    metrics = ",".join(METRICS_SONAR)

    componentes = []
    pagina = 1
    componente_principal = None

    while True:
        response = requests.get(
            url,
            auth=auth,
            params={
                "component": project_key,
                "branch": SONAR_BRANCH,
                "metricKeys": metrics,
                "qualifiers": "FIL,DIR,UTS",
                "ps": 500,
                "p": pagina,
            },
            timeout=60,
        )

        response.raise_for_status()
        dados = response.json()

        if componente_principal is None:
            componente_principal = dados.get("baseComponent")

        componentes.extend(dados.get("components", []))

        paging = dados.get("paging", {})
        total = paging.get("total", 0)
        page_size = paging.get("pageSize", 500)

        if pagina * page_size >= total:
            break

        pagina += 1

    measures = sonar_get('measures/component', component=project_key, metricKeys=metrics)['component']
    present = {item['metric'] for item in measures.get('measures', []) if 'value' in item}
    missing = set(METRICS_SONAR) - present
    if missing:
        raise RuntimeError(f'Métricas obrigatórias ausentes no Sonar: {", ".join(sorted(missing))}. Confira a importação do XML dos testes na branch.')
    if latest_analysis(project_key).get('key') != analysis['key']:
        raise RuntimeError('A análise mudou durante a coleta. Execute novamente para evitar misturar versões.')
    if not componentes:
        raise RuntimeError('O Sonar retornou uma lista vazia de componentes.')

    tag_formatada = tag if tag.startswith("v") else f"v{tag}"

    os.makedirs("analytics-raw-data", exist_ok=True)

    file_path = (
        "./analytics-raw-data/"
        "fga-eps-mds-2026_2_UNB-AnatoQuizUp-BFF-"
        f"{TODAY.strftime('%m-%d-%Y-%H-%M-%S')}-"
        f"{tag_formatada}.json"
    )

    resultado = {
        "timestamp": TODAY.isoformat(),
        "tag": tag_formatada,
        "project": project_key,
        "branch": SONAR_BRANCH,
        "commit": EXPECTED_SHA,
        "analysis": analysis,
        "project_measures": measures.get('measures', []),
        "metrics_requested": METRICS_SONAR,
        "baseComponent": componente_principal,
        "components": componentes,
    }

    with open(file_path, "w", encoding="utf-8") as arquivo:
        json.dump(resultado, arquivo, ensure_ascii=False, indent=2)

    print(f"Métricas SonarCloud exportadas: {file_path}")
    print(f"Componentes coletados: {len(componentes)}")

##################
# FUNÇÕES GITHUB #
##################

def all_request_pages(data):
    total_runs = data["total_count"]
    pages = (total_runs // 100) + (1 if total_runs % 100 > 0 else 0)
    for i in range(pages+1):
        if i == 0 or i == 1:
            continue
        api_url_now = api_url_runs + "?page=" + str(i)
        response = requests.get(api_url_now, params={'per_page': 100}, headers={'Authorization': f'Bearer {GITHUB_TOKEN}'}, timeout=60)
        response.raise_for_status()
        for j in ((response.json()['workflow_runs'])):
            data['workflow_runs'].append(j)
    return data

def filter_request_per_date(data, date):
    data_filtered = []
    for i in data["workflow_runs"]:
        if datetime.strptime(i["created_at"][:10],"%Y-%m-%d").strftime("%Y-%m-%d") == date:
            data_filtered.append(i)
    return {"workflow_runs": data_filtered}

def save_github_metrics_runs():
    response = requests.get(api_url_runs, params={'per_page': 100}, headers={'Authorization': f'Bearer {GITHUB_TOKEN}'}, timeout=60)
    response.raise_for_status()

    data = response.json()

    # date = datetime.strptime("2023-03-23","%Y-%m-%d").strftime("%Y-%m-%d")
    data = all_request_pages(data)

    print("Quantidade de workflow_runs: " + str(len(data["workflow_runs"])))

    file_path = f'./analytics-raw-data/GitHub_API-Runs-fga-eps-mds-{REPO}-{TODAY.strftime("%m-%d-%Y-%H-%M-%S")}.json'

    # Salva os dados em um json file
    with open(file_path, 'w') as fp:
        fp.write(json.dumps(data))
        fp.close()

    return

def save_github_metrics_issues():
    issues = []
    page = 1

    while True:
        response = requests.get(api_url_issues, params={'state': 'all', 'per_page': 100, 'page': page}, headers={'Authorization': f'Bearer {GITHUB_TOKEN}'}, timeout=60)
        response.raise_for_status()

        page_issues = response.json()
        if not page_issues:
            break

        issues.extend(page_issues)
        print(f"Página {page}: {len(page_issues)} issues carregadas.")

        page += 1

    print("Quantidade total de issues: " + str(len(issues)))

    file_path = f'./analytics-raw-data/GitHub_API-Issues-fga-eps-mds-{REPO_ISSUES}-{TODAY.strftime("%m-%d-%Y-%H-%M-%S")}.json'

    # Salvar todas as issues em um arquivo JSON
    with open(file_path, 'w') as fp:
        json.dump(issues, fp, indent=4)

def main():
    if not GITHUB_TOKEN or not SONAR_TOKEN or not EXPECTED_SHA or not SONAR_BRANCH:
        raise RuntimeError('Configure os tokens, EXPECTED_SHA e SONAR_BRANCH antes da coleta.')
    release_flags = [RELEASE_MAJOR, RELEASE_MINOR, RELEASE_FIX]
    if release_flags.count('true') > 1:
        raise RuntimeError('Use apenas uma label de release por PR.')
    is_release = (
        RELEASE_MAJOR == "true"
        or RELEASE_MINOR == "true"
        or RELEASE_FIX == "true"
    )

    existing_release = None
    if is_release:
        if SONAR_BRANCH != 'main':
            raise RuntimeError('Releases de produto devem partir da branch main.')
        existing_release = release_for_commit()
        tag = existing_release['tag_name'] if existing_release else new_tag_name()
    else:
        tag = get_latest_release()

    save_sonar_metrics(tag)
    save_github_metrics_runs()
    save_github_metrics_issues()
    if is_release and not existing_release:
        create_release(tag)


if __name__ == '__main__':
    main()
