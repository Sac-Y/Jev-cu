#!/bin/sh
set -eu
python3 - <<'JEV_KEY'
import getpass, os
from pathlib import Path
p = Path.home() / '.local/share/jev-cu/.env.local'
if not p.is_file():
    raise SystemExit('Install the team edition first.')
key = getpass.getpass('Paste your TypeSafe API key, then press Enter (hidden): ').strip()
if not key or any(c.isspace() for c in key) or any(c in key for c in ['\x00', '"', "'"]):
    raise SystemExit('Invalid or empty key. Nothing was saved.')
lines = [line for line in p.read_text().splitlines() if not line.strip().startswith('TYPESAFE_API_KEY=')]
lines.append('TYPESAFE_API_KEY=' + key)
fd = os.open(p, os.O_WRONLY | os.O_TRUNC)
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('Key saved locally. No API request was made.')
JEV_KEY
