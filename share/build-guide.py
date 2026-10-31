from pathlib import Path
import base64, hashlib, html, io, json, zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).parent
files = [ROOT / name for name in ['package.json', 'package-lock.json', '.gitignore', 'README.md']]
for folder in ['scripts', 'tests', 'skill', 'fixtures']:
    files += [p for p in (ROOT / folder).rglob('*') if p.is_file()]
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(files):
        text = p.read_text().replace('/Users/a1/.agents/skills/jev-use', '{{USER_SKILL_DIR}}').replace('/Users/a1/Projects/Jev-cu', '{{REPO_DIR}}')
        archive.writestr(str(p.relative_to(ROOT)), text)
payload = buffer.getvalue()
encoded = base64.b64encode(payload).decode()
digest = hashlib.sha256(payload).hexdigest()
(OUT / 'jev-orca-team.zip').write_bytes(payload)

installer = '''python3 - <<'JEV_INSTALL'
import base64, hashlib, io, os, pathlib, platform, shutil, subprocess, tempfile, zipfile
if platform.system() != 'Darwin':
    raise SystemExit('This team edition is verified on macOS only.')
for command in ['node', 'npm', 'orca']:
    if not shutil.which(command):
        raise SystemExit('Required command is missing: ' + command + '. Install it, then retry in the ORCA terminal.')
major = int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'], text=True).strip())
if major < 18:
    raise SystemExit('Node.js 18 or newer is required.')
root = pathlib.Path.home() / '.local/share/jev-cu'
skill = pathlib.Path.home() / '.agents/skills/jev-use'
if root.exists() or root.is_symlink() or skill.exists() or skill.is_symlink():
    raise SystemExit('Jev installation already exists. Nothing was overwritten. Ask your agent to inspect it before updating.')
data = base64.b64decode('PAYLOAD')
if hashlib.sha256(data).hexdigest() != 'DIGEST':
    raise SystemExit('Package checksum mismatch. Copy the installation command again.')
root.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='jev-install-', dir=root.parent) as temp:
    stage = pathlib.Path(temp) / 'source'
    stage.mkdir()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for item in archive.infolist():
            rel = pathlib.PurePosixPath(item.filename)
            if rel.is_absolute() or '..' in rel.parts:
                raise SystemExit('Unsafe package path.')
        archive.extractall(stage)
    for p in stage.rglob('*'):
        if p.is_file():
            value = p.read_text().replace('{{REPO_DIR}}', str(root)).replace('{{USER_SKILL_DIR}}', str(skill))
            p.write_text(value)
    subprocess.run(['npm', 'test'], cwd=stage, check=True)
    stage.rename(root)
skill.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(root / 'skill/jev-use', skill)
fd = os.open(root / '.env.local', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write('TYPESAFE_API_KEY=\\n')
print('Installed: ' + str(root))
print('Shared skill: ' + str(skill))
print('Tests passed. No paid API requests were made. Next: register your own TypeSafe key.')
JEV_INSTALL'''.replace('PAYLOAD', encoded).replace('DIGEST', digest)

key_command = '''python3 - <<'JEV_KEY'
import getpass, os
from pathlib import Path
p = Path.home() / '.local/share/jev-cu/.env.local'
if not p.is_file():
    raise SystemExit('Install the team edition first.')
key = getpass.getpass('Paste your TypeSafe API key, then press Enter (hidden): ').strip()
if not key or any(c.isspace() for c in key) or any(c in key for c in ['\\x00', '"', "'"]):
    raise SystemExit('Invalid or empty key. Nothing was saved.')
lines = [line for line in p.read_text().splitlines() if not line.strip().startswith('TYPESAFE_API_KEY=')]
lines.append('TYPESAFE_API_KEY=' + key)
fd = os.open(p, os.O_WRONLY | os.O_TRUNC)
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write('\\n'.join(lines) + '\\n')
print('Key saved locally. No API request was made.')
JEV_KEY'''

verify_command = '''cd "$HOME/.local/share/jev-cu" && npm test
# 실제 화면 읽기는 대상 앱 창을 연 뒤 실행합니다. API 호출은 없습니다.
# npm run orca:check -- com.apple.iCal --restore-window'''

prompts = {
 'audit': '''개발 사이트를 실제 브라우저로 열어 주요 사용자 흐름과 UI/UX를 검수해줘.
먼저 이 프로젝트의 실행 방법을 확인하고, 접속 주소나 테스트 계정이 없으면 필요한 것만 물어봐.
메뉴 이동·폼 입력·오류/빈 상태·모바일 화면·키보드 이동을 확인해줘.
웹 검수에는 적합한 브라우저 자동화를 우선 사용하고, 외부 앱의 텍스트 기반 조작에 필요하면 $jev-use를 사용해.
Jev 유료 API는 이 검수에서 재시도 포함 최대 5회까지만 허용해. 테스트 데이터만 사용해줘.
실제 결제·발송·삭제·운영 데이터 변경은 하지 마.
문제별로 심각도, 재현 순서, 기대/실제 결과, 스크린샷을 정리해줘.
실제로 확인한 범위와 확인하지 못한 범위를 구분하고, 코드 수정은 제안까지만 해줘.''',
 'flow': '''개발 사이트의 회원가입 → 로그인 → 첫 화면 흐름을 실제 브라우저에서 검수해줘.
테스트 환경과 테스트 계정만 사용하고, 필요한 정보가 없으면 먼저 확인해줘.
정상 입력과 잘못된 입력, 중복 클릭, 로딩 상태, 키보드 이동을 확인해줘.
브라우저 도구를 우선 사용하고, 필요하면 $jev-use를 사용해.
Jev 유료 API는 재시도 포함 최대 5회까지 허용해. 실제 이메일/SMS 발송은 별도 승인 없이 하지 마.
재현 가능한 문제와 확인하지 못한 항목을 구분해 보고해줘.''',
 'jev': '''$jev-use로 macOS 캘린더를 주간 보기로 바꾸고 선택 상태를 확인해줘.
설치 경로는 ~/.local/share/jev-cu야. ORCA 어댑터를 사용해줘.
먼저 로컬 화면을 읽고, 보기 전환 버튼과 선택 상태만 Jev에 전달해줘. 일정 제목이나 참석자는 보내지 마.
처음에는 dry-run으로 확인하고, 안전한 보기 전환만 실행해줘.
Jev 유료 API는 dry-run과 재시도를 포함해 최대 3회까지 허용해.
이미 주간 보기면 API 호출 없이 완료해. 일정을 생성·수정·삭제하지 마.
Jev의 완료 판단만 믿지 말고 실제 선택 상태로 결과를 확인해줘.'''
}
(OUT / 'install-jev-orca.sh').write_text('#!/bin/sh\nset -eu\n' + installer + '\n')
(OUT / 'register-key.sh').write_text('#!/bin/sh\nset -eu\n' + key_command + '\n')
data = json.dumps({'install': installer, 'key': key_command, 'verify': verify_command, **prompts}, ensure_ascii=False).replace('</', '<\\/')

page = r'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f4ed">
<meta name="description" content="화면 조작을 AI에게 맡기는 Jev × ORCA. 개발자를 위한 쉬운 소개, 복사형 설치, 바로 쓰는 검수 프롬프트.">
<title>클릭은 맡기고, 개발에 집중하세요 · Jev × ORCA</title>
<style>
:root{--paper:#f5f4ed;--ink:#202e29;--muted:#58665e;--line:#d4d9ce;--green:#235a3e;--lime:#d7ed9d;--white:#fcfcf7;--radius:18px}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.65;word-break:keep-all}a{color:inherit;text-underline-offset:4px}button,a{touch-action:manipulation}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible,textarea:focus-visible{outline:3px solid #377950;outline-offset:5px}button:hover{filter:brightness(.94)}a:hover{color:var(--green)}.wrap{max-width:1100px;margin:auto;padding:0 32px}.skip{position:absolute;top:-100px;left:20px;background:var(--lime);padding:12px;z-index:9}.skip:focus{top:10px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:25px 0;border-bottom:1px solid var(--line)}.brand{font-family:"Avenir Next",sans-serif;font-weight:800;font-size:22px;letter-spacing:-1px}.brand span{color:var(--green);font-weight:400;margin:0 6px}.edition,.eyebrow{font-size:11px;letter-spacing:1.8px;font-weight:700}.top a{font-size:13px;text-decoration:none}.hero{padding:76px 0 58px;display:grid;grid-template-columns:1.13fr 1fr;align-items:center;gap:50px}.eyebrow{color:var(--green);margin:0 0 20px}.hero h1{font-size:clamp(38px,5.5vw,62px);line-height:1.16;letter-spacing:-3px;margin:0 0 24px;text-wrap:balance}.hero h1 em{font-style:normal;color:var(--green)}.intro{font-size:18px;color:var(--muted);max-width:450px;line-height:1.85}.btn{border:0;display:inline-flex;align-items:center;justify-content:center;gap:12px;padding:13px 20px;border-radius:8px;background:var(--green);color:var(--white);font-size:14px;font-weight:700;text-decoration:none;min-height:46px}.btn:hover{color:var(--white)}.btn.light{background:var(--lime);color:var(--ink)}.btn.ghost{border:1px solid var(--line);background:transparent;color:var(--ink)}.hero-actions{display:flex;align-items:center;gap:20px;margin-top:28px;flex-wrap:wrap}.hero-actions>a:last-child{font-size:14px}.small{font-size:12px;color:var(--muted)}.hero .small{margin-top:18px}.demo{background:#e9eddf;border:1px solid #cdd6c4;border-radius:var(--radius);padding:22px;transform:rotate(1deg)}.demo-label{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:18px;letter-spacing:1px}.bubble{background:var(--white);padding:17px 20px;border-radius:12px 12px 2px 12px;font-size:15px;font-weight:700;max-width:310px;margin-left:auto}.mock{background:var(--white);border:1px solid var(--line);border-radius:12px;margin-top:20px;padding:17px}.mock-top{display:flex;align-items:center;gap:5px;border-bottom:1px solid #e7e9df;padding-bottom:12px;margin-bottom:16px}.dot{height:6px;width:6px;background:#bbc6b7;border-radius:50%}.mock-top span:last-child{margin-left:auto;font-size:10px;color:var(--muted)}.mock-row{display:flex;justify-content:space-between;align-items:center;gap:10px}.mock-row strong{font-size:15px}.seg{display:flex;gap:3px;font-size:12px}.seg span{padding:5px 9px}.seg .chosen{background:var(--lime);border-radius:5px;outline:1px solid var(--green);position:relative}.chosen::after{content:'↖';position:absolute;bottom:-20px;right:-13px;font-size:28px;color:var(--green)}.calendar{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:25px}.calendar i{height:30px;border-radius:4px;background:#f0f1e9}.calendar i:nth-child(3){background:#d4e6b1}.demo-foot{margin-top:20px;display:flex;align-items:center;gap:9px;font-size:12px;color:var(--green)}.dot.live{background:var(--green)}.band{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:24px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px}.band strong{display:block;font-size:16px;margin-bottom:3px}.band p{font-size:13px;color:var(--muted);margin:0}.section{padding:64px 0;border-bottom:1px solid var(--line)}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:26px}.section h2{font-size:30px;letter-spacing:-1.3px;line-height:1.35;margin:0}.section-head>p{margin:0;font-size:13px;color:var(--muted)}.roles{display:flex;gap:18px;align-items:center;margin:30px 0 22px}.role{flex:1}.role b{display:block;font-size:17px}.role p{font-size:14px;color:var(--muted);margin:5px 0}.arrow{color:#899985}.note{font-size:14px;color:var(--muted);background:#e9ecdf;padding:18px 22px;border-radius:9px;margin:20px 0 0}.note b{color:var(--ink)}.requirements{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 30px}.tag{border:1px solid var(--line);padding:5px 11px;border-radius:30px;font-size:12px}.step{display:grid;grid-template-columns:45px 1fr;gap:18px;padding:28px 0;border-top:1px solid var(--line)}.num{font-family:"Avenir Next",sans-serif;font-size:24px;color:var(--green);font-weight:600}.step h3{margin:0 0 8px;font-size:20px;letter-spacing:-.6px}.step p{margin:0 0 15px;color:var(--muted);font-size:14px}.command{background:#23392d;color:#e6efda;border-radius:12px;padding:20px;display:flex;gap:20px;align-items:center;justify-content:space-between}.command .name{font-size:14px;font-weight:700}.command .hint{font-size:12px;color:#c2d1b9;margin-top:3px}.command .btn{flex-shrink:0}.details{margin-top:12px}summary{cursor:pointer;font-size:13px;color:var(--muted);padding:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;font:12px/1.7 "SFMono-Regular",Consolas,monospace;background:#e9ecdf;padding:18px;border-radius:8px;max-height:330px;overflow:auto;margin:10px 0}code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.89em;overflow-wrap:anywhere}.inline-actions{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.subnote{font-size:12px!important;margin-top:12px!important}.prompt-layout{display:grid;grid-template-columns:230px 1fr;gap:30px}.choices{display:flex;flex-direction:column;gap:5px}.choice{text-align:left;background:transparent;border:0;border-radius:8px;padding:14px 16px;color:var(--muted);font-size:14px}.choice[aria-pressed=true]{background:#e0e8d3;color:var(--green);font-weight:700}.prompt-panel{background:var(--white);padding:25px;border:1px solid var(--line);border-radius:12px}.prompt-panel pre{padding:0;background:transparent;font-family:inherit;font-size:14px;line-height:1.9;word-break:keep-all;max-height:none;margin:0 0 22px}.prompt-footer{display:flex;align-items:center;justify-content:space-between;gap:15px}.faq details{border-top:1px solid var(--line);padding:10px 0}.faq summary{color:var(--ink);font-size:16px;font-weight:600;padding:15px 0}.faq p{font-size:14px;color:var(--muted);margin:0 0 16px;max-width:790px}.footer{padding:28px 0 45px;display:flex;justify-content:space-between;gap:25px;color:var(--muted);font-size:12px}.footer p{margin:0}.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--white);padding:13px 22px;border-radius:9px;font-size:14px;max-width:calc(100% - 32px);z-index:10;box-shadow:0 5px 25px #20302426}.toast:empty{display:none}.copy-fallback{position:fixed;inset:10% 8%;background:var(--white);padding:24px;border:2px solid var(--green);border-radius:12px;z-index:20;box-shadow:0 0 0 100vmax #202e2966}.copy-fallback[hidden]{display:none}.copy-fallback textarea{width:100%;height:65%;font:12px/1.5 monospace;padding:12px;resize:vertical}.copy-fallback label{display:block;font-size:16px;font-weight:700;margin-bottom:15px}.copy-fallback .btn{margin-top:16px}.proof{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--green);margin-top:22px}noscript{display:block;background:#ffe6bc;padding:18px}.support{font-size:12px;color:var(--muted);margin-top:18px}
@media(max-width:760px){.wrap{padding:0 22px}.top{padding:18px 0}.edition{display:none}.hero{padding:44px 0 35px;grid-template-columns:1fr;gap:30px}.hero h1{letter-spacing:-2px}.intro{font-size:16px}.demo{transform:none;max-width:490px}.section{padding:42px 0}.section h2{font-size:26px}.section-head{display:block}.section-head>p{margin-top:10px}.band{grid-template-columns:1fr;gap:17px}.band strong{display:inline;margin-right:8px}.band p{display:inline}.roles{gap:14px;align-items:stretch}.role b{font-size:15px}.role p{font-size:12px}.arrow{display:none}.step{grid-template-columns:30px 1fr;gap:12px}.command{display:block;padding:18px}.command .btn{width:100%;margin-top:15px}.prompt-layout{grid-template-columns:1fr;gap:15px}.choices{flex-direction:row;flex-wrap:wrap;gap:5px}.choice{padding:10px 12px;font-size:12px}.prompt-panel{padding:20px}.prompt-footer{align-items:flex-start;flex-direction:column}.footer{flex-direction:column;gap:12px}.copy-fallback{inset:6% 5%}.proof{gap:8px 18px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{.btn,.top a,.choices,.toast,.details,.copy-fallback{display:none!important}.section{padding:25px 0}.hero{padding:25px 0}body{font-size:12px}.wrap{max-width:none}.demo{break-inside:avoid}.step,.prompt-panel{break-inside:avoid}}
</style></head><body><a href="#main" class="skip">본문으로 건너뛰기</a><div class="wrap">
<header class="top"><div class="brand" translate="no">Jev <span>×</span> ORCA</div><div class="edition">DEVELOPER FIELD GUIDE · TEAM EDITION</div><a href="#install">설치로 바로 가기 ↗</a></header>
<main id="main"><section class="hero"><div><p class="eyebrow">반복되는 화면 조작, 이제 말로 맡기세요</p><h1>클릭은 맡기고,<br><em>개발에 집중하세요.</em></h1><p class="intro">“이 화면, 직접 눌러서 확인해줘.”<br>Jev가 누를 곳을 고르면 ORCA가 조작하고,<br>에이전트가 결과를 확인합니다.</p><div class="hero-actions"><a class="btn" href="#install">복사해서 설치하기 <span aria-hidden="true">↓</span></a><a href="#prompts">바로 쓰는 요청 예시 ↗</a></div><p class="small">macOS 개발자용 · ORCA 연결 코드 포함 · 개인 API 키 사용</p></div>
<div class="demo" role="img" aria-label="작동 방식 예시: 주간 보기로 바꿔 달라는 요청에 Jev가 주 버튼을 선택하고 ORCA가 클릭합니다. 실제 실행 화면은 아닙니다."><div class="demo-label"><span>이렇게 동작해요</span><span>설명용 예시</span></div><div class="bubble">캘린더를 주간 보기로 바꿔줘.</div><div class="mock"><div class="mock-top"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>CALENDAR</span></div><div class="mock-row"><strong>내 캘린더</strong><div class="seg"><span>일</span><span class="chosen">주</span><span>월</span><span>년</span></div></div><div class="calendar" aria-hidden="true">GRID</div></div><div class="demo-foot"><i class="dot live"></i>버튼 선택 → 실제 클릭 → 선택 상태 확인</div></div></section>
<div class="band"><div><strong>말로 요청하고</strong><p>목표를 설명하면 시작합니다.</p></div><div><strong>직접 조작하고</strong><p>앱의 버튼과 입력창을 다룹니다.</p></div><div><strong>결과까지 확인</strong><p>클릭 성공과 작업 완료를 구분합니다.</p></div></div>
<section class="section" aria-labelledby="what"><div class="section-head"><h2 id="what">쉽게 말해, 화면 조작의 역할 분담.</h2><p>익숙한 개발 에이전트에 선택지를 하나 더.</p></div><div class="roles"><div class="role"><b>에이전트 · 작업 정리</b><p>목표를 나누고 결과를 검수합니다.</p></div><span class="arrow" aria-hidden="true">→</span><div class="role"><b>Jev · 누를 곳 선택</b><p>화면의 글자를 보고 다음 행동을 고릅니다.</p></div><span class="arrow" aria-hidden="true">→</span><div class="role"><b>ORCA · 실제 조작</b><p>화면을 읽고 클릭·입력을 실행합니다.</p></div></div><p class="note"><b>특히 잘 맞는 일:</b> 보기 전환, 메뉴 이동, 텍스트 입력처럼 목표가 명확한 짧은 작업.<br>웹 UI/UX 전체 검수는 브라우저 도구와 에이전트가 함께 수행하며, Jev는 필요한 화면 조작을 돕습니다. 디자인의 완성도나 모든 오류를 혼자 판정하는 도구는 아닙니다.</p></section>
<section class="section" id="install"><div class="section-head"><h2>설치는 복사 → 붙여넣기.</h2><p>ORCA의 터미널에서 아래 순서대로 진행하세요.</p></div><div class="requirements"><span class="tag">macOS</span><span class="tag">ORCA 실행 + orca CLI</span><span class="tag">Node.js 18 이상 · npm</span><span class="tag">Python 3</span><span class="tag">개인 TypeSafe API 키</span></div>
<div class="step"><div class="num">01</div><div><h3>설치 명령 붙여넣기</h3><p>버튼을 눌러 복사한 뒤 ORCA 터미널에 붙여넣고 Enter를 누르세요. 원본 Jev와 팀용 ORCA 연결 코드를 설치하고 무료 테스트를 실행합니다.</p><div class="command"><div><div class="name">Jev + ORCA 팀 배포판 설치</div><div class="hint">이 HTML 안에 설치 코드가 들어 있습니다. 별도 다운로드 주소가 필요 없습니다.</div></div><button class="btn light" data-copy="install">설치 명령 복사 <span aria-hidden="true">↗</span></button></div><details class="details"><summary>실행할 설치 코드 확인하기</summary><pre id="install-code" tabindex="0">INSTALL_CODE</pre></details><p class="subnote">설치 위치: <code>~/.local/share/jev-cu</code> · 공용 스킬: <code>~/.agents/skills/jev-use</code><br>기존 설치가 있으면 덮어쓰지 않고 멈춥니다. 관리자 권한이나 유료 API 호출은 필요 없습니다.</p><button class="btn ghost" id="download-installer">설치 파일로 받기 (.sh)</button></div></div>
<div class="step"><div class="num">02</div><div><h3>내 API 키 등록하기</h3><p>먼저 아래 명령을 복사해 터미널에서 실행하세요. 키 입력 대기가 뜨면 <a href="https://console.typesafe.ai/settings/keys" target="_blank" rel="noopener noreferrer">TypeSafe에서 발급한 키 ↗</a>를 복사해 붙여넣고 Enter를 누르세요.</p><div class="command"><div><div class="name">키는 숨겨진 입력창에서 등록합니다</div><div class="hint">입력해도 글자가 표시되지 않는 것이 정상입니다.</div></div><button class="btn light" data-copy="key">키 등록 명령 복사</button></div><details class="details"><summary>키 등록 코드 확인하기</summary><pre id="key-code" tabindex="0">KEY_CODE</pre></details><p class="subnote">키는 본인만 읽고 쓰는 로컬 <code>.env.local</code> 파일에 저장됩니다. 채팅·공유 문서에는 붙이지 마세요. 이 단계는 키를 저장하며 API 인증을 호출하지는 않습니다.</p></div></div>
<div class="step"><div class="num">03</div><div><h3>무료 확인 후, 새 대화에서 사용하기</h3><p>아래 명령으로 테스트가 통과하는지 확인하세요. ORCA의 Codex 새 대화에서 <code>$jev-use</code>를 사용할 수 있습니다. 보이지 않으면 ORCA를 다시 시작하세요.</p><div class="inline-actions"><button class="btn" data-copy="verify">확인 명령 복사</button><a href="#prompts">첫 요청 골라보기 ↓</a></div><pre id="verify-code">VERIFY_CODE</pre><p class="subnote">첫 화면 조작 때 macOS 손쉬운 사용 권한이 필요할 수 있습니다. ORCA가 안내하는 권한을 허용하세요. 실제 API 인증은 첫 유료 요청 성공으로 확인됩니다.</p></div></div>
<p class="note"><b>알아두면 좋은 비용 구분</b><br>설치·단위 테스트·로컬 화면 읽기는 Jev를 호출하지 않습니다. Jev가 다음 행동을 판단할 때는 TypeSafe API 비용이 발생하고, 에이전트 사용량은 별도입니다. <code>dry-run</code>도 Jev를 부르면 유료입니다. 아래 예시에는 호출 상한을 넣었습니다.</p></section>
<section class="section" id="prompts"><div class="section-head"><h2>설치했다면, 이렇게 부탁하세요.</h2><p>복사해서 ORCA Codex 대화에 붙여넣으세요.</p></div><div class="prompt-layout"><div class="choices" role="group" aria-label="요청 예시 선택"><button class="choice" data-prompt="audit" aria-pressed="true">01 &nbsp; UI/UX 전체 검수</button><button class="choice" data-prompt="flow" aria-pressed="false">02 &nbsp; 회원가입 흐름 검수</button><button class="choice" data-prompt="jev" aria-pressed="false">03 &nbsp; Jev 첫 조작 체험</button></div><div class="prompt-panel"><pre id="prompt-text">AUDIT_TEXT</pre><div class="prompt-footer"><span class="small" id="budget-note">Jev 최대 5회 · 실제 발송·결제·삭제 제외</span><button class="btn" id="copy-prompt">이 요청 복사</button></div></div></div><p class="support">전체 검수는 모든 경우의 무결성을 보장하지 않습니다. 테스트 주소·계정·실행 환경이 준비되어야 하며, 확인한 범위와 미확인 범위를 나누어 보고합니다.</p></section>
<section class="section faq"><div class="section-head"><h2>궁금한 건, 짧게 정리했어요.</h2></div><details><summary>다른 프로젝트에서도 쓸 수 있나요?</summary><p>네. 같은 Mac 사용자로 실행하는 Codex에서 프로젝트와 관계없이 찾을 수 있는 공용 스킬 경로에 설치합니다. 다른 컴퓨터·사용자·원격 환경에는 별도 설치가 필요하며, 다른 에이전트 제품까지 자동 적용되지는 않습니다.</p></details><details><summary>설치하면 모든 작업에 자동으로 Jev를 쓰나요?</summary><p>아니요. 백그라운드 서비스가 생기거나 코딩 모델이 바뀌지 않습니다. Jev를 명시해 요청한 컴퓨터 조작에 사용합니다. 웹사이트 검수는 브라우저 도구가 더 적합할 수 있습니다.</p></details><details><summary>원본 GitHub 저장소만 설치해도 똑같나요?</summary><p>아니요. 이 배포판은 원본 Jev-cu에 ORCA 실행 어댑터와 한국어 macOS 역할명 변환을 추가했습니다. 원본은 Codex 데스크톱의 cua_repl 실행 방식입니다. 이 HTML에는 팀 배포판 코드가 포함되어 있어 원본을 별도로 수정할 필요가 없습니다.</p></details><details><summary>내 화면이나 비밀번호가 외부로 가나요?</summary><p>Jev 판단에 필요한 화면 텍스트가 TypeSafe API로 전송됩니다. 이 연결은 스크린샷을 보내지 않지만, 화면 글자에도 민감한 정보가 있을 수 있습니다. 테스트 계정과 테스트 데이터를 사용하고, 관련 없는 일정·메시지·개인정보는 전달 범위에서 제외하세요.</p></details><details><summary>어디까지 확인된 배포판인가요?</summary><p>제작 Mac에서 테스트 24개 통과, 캘린더 요소 206개 읽기, 가상 데이터로 Jev API 인증 1회 성공을 확인했습니다. 실제 GUI 클릭은 모의 테스트로 검증했으며, 모든 앱에서의 실제 동작·속도·비용 절감은 보장하지 않습니다. Windows·Linux용 검증은 포함하지 않았습니다.</p></details><details><summary>설치 버튼이 복사되지 않으면요?</summary><p>복사 권한이 제한된 뷰어에서는 수동 복사창을 제공합니다. 공유 페이지에서 스크립트 자체가 차단되면 HTML 파일을 내려받아 Chrome이나 Safari로 여세요. 설치 파일 다운로드 후 내용을 검토하고 터미널에서 <code>sh ~/Downloads/install-jev-orca.sh</code>로 실행할 수도 있습니다.</p></details></section>
<div class="proof"><span>✓ ORCA 연결 코드 포함</span><span>✓ API 키·개인 설정 미포함</span><span>✓ 외부 폰트·추적 스크립트 없음</span></div></main>
<footer class="footer"><div><p>Jev × ORCA · 개발팀 공유 가이드</p><p>2026.09.21 · 팀용 확장판 · 이 HTML 파일 하나로 공유 가능</p></div><div><a href="https://github.com/Sac-Y/Jev-cu" target="_blank" rel="noopener noreferrer">원본 Sac-Y/Jev-cu ↗</a><br><span>기준 커밋 38fb31d · 팀 확장 코드는 이 문서에 포함</span></div></footer></div>
<noscript>복사 버튼에는 JavaScript가 필요합니다. 설치 코드 펼치기에서 직접 복사하거나, 이 HTML 파일을 일반 브라우저에서 열어주세요.</noscript><div class="toast" role="status" aria-live="polite" id="toast"></div>
<div class="copy-fallback" id="fallback" role="dialog" aria-modal="true" aria-labelledby="fallback-label" hidden><label id="fallback-label" for="manual-copy">자동 복사가 막혔습니다. 아래 내용을 ⌘C로 복사하세요.</label><textarea id="manual-copy" readonly spellcheck="false"></textarea><button class="btn" id="close-fallback">닫기</button></div>
<script id="guide-data" type="application/json">GUIDE_DATA</script>
<script>
const content=JSON.parse(document.getElementById('guide-data').textContent);let chosen='audit',timer,lastFocus;
function notify(message){const el=document.getElementById('toast');el.textContent=message;clearTimeout(timer);timer=setTimeout(()=>el.textContent='',3500)}
async function copy(text){try{await navigator.clipboard.writeText(text);notify('복사했습니다. ORCA에 붙여넣으세요.')}catch{lastFocus=document.activeElement;document.getElementById('fallback').hidden=false;const box=document.getElementById('manual-copy');box.value=text;box.focus();box.select()}}
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',()=>copy(content[button.dataset.copy])));
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{chosen=button.dataset.prompt;document.querySelectorAll('[data-prompt]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.getElementById('prompt-text').textContent=content[chosen];document.getElementById('budget-note').textContent=chosen==='jev'?'Jev 최대 3회 · 일정 생성·수정·삭제 제외':'Jev 최대 5회 · 실제 발송·결제·삭제 제외'}));
document.getElementById('copy-prompt').addEventListener('click',()=>copy(content[chosen]));
function closeFallback(){document.getElementById('fallback').hidden=true;lastFocus?.focus()}
document.getElementById('close-fallback').addEventListener('click',closeFallback);
document.getElementById('fallback').addEventListener('keydown',event=>{if(event.key==='Escape')closeFallback();if(event.key==='Tab'){const box=document.getElementById('manual-copy'),close=document.getElementById('close-fallback');if(event.shiftKey&&document.activeElement===box){event.preventDefault();close.focus()}else if(!event.shiftKey&&document.activeElement===close){event.preventDefault();box.focus()}}});
document.getElementById('download-installer').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob(['#!/bin/sh\nset -eu\n'+content.install+'\n'],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='install-jev-orca.sh';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);notify('설치 파일 다운로드를 시작했습니다.')});
</script></body></html>'''
page = page.replace('GRID', '<i></i>' * 21).replace('INSTALL_CODE', html.escape(installer)).replace('KEY_CODE', html.escape(key_command)).replace('VERIFY_CODE', html.escape(verify_command)).replace('AUDIT_TEXT', html.escape(prompts['audit'])).replace('GUIDE_DATA', data)
(OUT / 'jev-orca-guide.html').write_text(page)
print(json.dumps({'html': str(OUT / 'jev-orca-guide.html'), 'bytes': len(page.encode()), 'packageFiles': len(files), 'packageSha256': digest}, ensure_ascii=False))
