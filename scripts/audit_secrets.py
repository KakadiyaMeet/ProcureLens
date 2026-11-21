import os
import re

PATTERNS = [
    re.compile(r'(?i)(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["\'][a-zA-Z0-9_\-\.]{8,}["\']'),
    re.compile(r'-----BEGIN [A-Z0-9\s_-]+KEY-----'),
    re.compile(r'ghp_[a-zA-Z0-9]{36}'),
    re.compile(r'xox[baprs]-[0-9]{12}-[0-9]{12}-[a-zA-Z0-9]{24}'),
    re.compile(r'AIza[0-9A-Za-z_-]{35}'),
    re.compile(r'sk-[a-zA-Z0-9]{32,}'),
    re.compile(r'eyJh[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}'), # JWT
    re.compile(r'(?i)password\s*[:=]\s*["\'][^"\']+["\']'),
]

IGNORE_DIRS = {'.git', 'node_modules', 'dist', '.wrangler', '.deepspace', '.gemini'}
ALLOWED_FILES = {'audit_secrets.py'}

def scan():
    findings = []
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for file in files:
            if file in ALLOWED_FILES:
                continue
            path = os.path.join(root, file)
            # check common code / config extensions
            if not file.endswith(('.ts', '.tsx', '.js', '.jsx', '.json', '.toml', '.yml', '.yaml', '.py', '.md', '.html', '.css', '.env', '.vars')):
                continue
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line_no, line in enumerate(f, 1):
                        for p in PATTERNS:
                            m = p.search(line)
                            if m:
                                findings.append((path, line_no, line.strip(), m.group(0)))
            except Exception as e:
                print(f"Error reading {path}: {e}")
    return findings

if __name__ == '__main__':
    # Self-test patterns
    test_samples = [
        'api_key = "abcdef123456"',
        'ghp_123456789012345678901234567890123456',
        'sk-12345678901234567890123456789012',
        'password = "supersecret123"',
        'AIzaSyD-1234567890123456789012345678901',
        '-----BEGIN RSA PRIVATE KEY-----'
    ]
    for sample in test_samples:
        matched = any(p.search(sample) for p in PATTERNS)
        assert matched, f"Failed to match sample: {sample}"
    print("Pattern self-test passed: 6/6 test signatures detected.")

    results = scan()
    print(f"Total potential secret findings: {len(results)}")
    for path, line_no, line, match in results:
        print(f"{path}:{line_no} => MATCH: {match}")
        print(f"   LINE: {line[:120]}")
