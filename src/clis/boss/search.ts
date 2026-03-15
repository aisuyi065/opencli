/**
 * BOSS直聘 job search — direct HTTP with browser-extracted cookies.
 *
 * BOSS Zhipin actively detects CDP/Playwright automation and kills pages.
 * Instead, we extract cookies from Chrome's local storage (like boss-cli does)
 * and make direct Node.js fetch() requests with proper anti-detection headers.
 *
 * Cookie extraction priority:
 *   1. ~/.config/boss-cli/credential.json (if boss-cli is installed)
 *   2. Python browser-cookie3 extraction (same technique as boss-cli)
 *   3. Clear error message with instructions
 *
 * Ref: ~/code/cli/boss-cli/boss_cli/client.py, auth.py, constants.py
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';

// ── City codes (from boss-cli/constants.py) ──────────────────────────

const CITY_CODES: Record<string, string> = {
  '全国': '100010000', '北京': '101010100', '上海': '101020100',
  '广州': '101280100', '深圳': '101280600', '杭州': '101210100',
  '成都': '101270100', '南京': '101190100', '武汉': '101200100',
  '西安': '101110100', '苏州': '101190400', '长沙': '101250100',
  '天津': '101030100', '重庆': '101040100', '郑州': '101180100',
  '东莞': '101281600', '青岛': '101120200', '合肥': '101220100',
  '佛山': '101280800', '宁波': '101210400', '厦门': '101230200',
  '大连': '101070200', '珠海': '101280700', '无锡': '101190200',
  '济南': '101120100', '福州': '101230100', '昆明': '101290100',
  '哈尔滨': '101050100', '沈阳': '101070100', '石家庄': '101090100',
  '贵阳': '101260100', '南宁': '101300100', '太原': '101100100',
  '海口': '101310100', '兰州': '101160100', '乌鲁木齐': '101130100',
  '长春': '101060100', '南昌': '101240100', '常州': '101191100',
  '温州': '101210700', '嘉兴': '101210300', '徐州': '101190800',
  '香港': '101320100',
};

// ── Filter code maps (from boss-cli/constants.py) ────────────────────

const EXP_MAP: Record<string, string> = {
  '不限': '0', '在校/应届': '108', '应届': '108', '1年以内': '101',
  '1-3年': '102', '3-5年': '103', '5-10年': '104', '10年以上': '105',
};
const DEGREE_MAP: Record<string, string> = {
  '不限': '0', '初中及以下': '209', '中专/中技': '208', '高中': '206',
  '大专': '202', '本科': '203', '硕士': '204', '博士': '205',
};
const SALARY_MAP: Record<string, string> = {
  '不限': '0', '3K以下': '401', '3-5K': '402', '5-10K': '403',
  '10-15K': '404', '15-20K': '405', '20-30K': '406', '30-50K': '407', '50K以上': '408',
};
const INDUSTRY_MAP: Record<string, string> = {
  '不限': '0', '互联网': '100020', '电子商务': '100021', '游戏': '100024',
  '人工智能': '100901', '大数据': '100902', '金融': '100101',
  '教育培训': '100200', '医疗健康': '100300',
};

// ── Anti-detection headers (from boss-cli/constants.py) ──────────────

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="145", "Not(A:Brand";v="99", "Google Chrome";v="145"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'DNT': '1',
  'Origin': 'https://www.zhipin.com',
};

// ── Cookie extraction ────────────────────────────────────────────────

/** Python script to extract cookies from Chrome (same as boss-cli/auth.py) */
const COOKIE_EXTRACT_SCRIPT = `
import json, sys
try:
    import browser_cookie3 as bc3
except ImportError:
    print(json.dumps({"error": "not_installed"}))
    sys.exit(0)
browsers = [
    ("Chrome", bc3.chrome), ("Firefox", bc3.firefox), ("Edge", bc3.edge),
    ("Brave", bc3.brave), ("Chromium", bc3.chromium), ("Opera", bc3.opera),
    ("Vivaldi", bc3.vivaldi),
]
for name, attr in [("Arc", "arc"), ("Safari", "safari"), ("LibreWolf", "librewolf")]:
    fn = getattr(bc3, attr, None)
    if fn: browsers.append((name, fn))
for name, loader in browsers:
    try:
        cj = loader(domain_name=".zhipin.com")
        cookies = {c.name: c.value for c in cj if "zhipin.com" in (c.domain or "")}
        if cookies:
            print(json.dumps({"browser": name, "cookies": cookies}))
            sys.exit(0)
    except Exception:
        pass
print(json.dumps({"error": "no_cookies"}))
`;

// Local cache for credentials within the process
let _cachedCookieHeader: string | null = null;

function extractCookiesViaPython(): Record<string, string> | null {
  try {
    const result = execSync(`python3 -c ${JSON.stringify(COOKIE_EXTRACT_SCRIPT)}`, {
      timeout: 15000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const data = JSON.parse(result.trim());
    if (data.error) return null;
    return data.cookies || null;
  } catch {
    return null;
  }
}

function loadCookieHeader(): string {
  if (_cachedCookieHeader) return _cachedCookieHeader;

  // Priority 1: extract fresh from Chrome via browser-cookie3
  const extracted = extractCookiesViaPython();
  if (extracted && Object.keys(extracted).length > 0) {
    _cachedCookieHeader = Object.entries(extracted).map(([k, v]) => `${k}=${v}`).join('; ');
    // Save for future use
    try {
      const configDir = path.join(os.homedir(), '.config', 'boss-cli');
      const credPath = path.join(configDir, 'credential.json');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(credPath, JSON.stringify({ cookies: extracted, saved_at: Date.now() / 1000 }, null, 2));
    } catch { /* ignore save errors */ }
    return _cachedCookieHeader;
  }

  // Priority 2: boss-cli credential file (fallback)
  try {
    const credPath = path.join(os.homedir(), '.config', 'boss-cli', 'credential.json');
    const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const cookies: Record<string, string> = data.cookies || {};
    if (Object.keys(cookies).length > 0) {
      _cachedCookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      return _cachedCookieHeader;
    }
  } catch { /* not available */ }

  throw new Error(
    'BOSS 直聘需要 Cookie 登录态。请确保:\n' +
    '  1. 你已在 Chrome 中登录 www.zhipin.com\n' +
    '  2. 安装 browser-cookie3: pip install browser-cookie3\n' +
    '或者安装 boss-cli: pip install kabi-boss-cli && boss login'
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function resolveCity(input: string): string {
  if (!input) return '101010100';
  if (/^\d+$/.test(input)) return input;
  if (CITY_CODES[input]) return CITY_CODES[input];
  for (const [name, code] of Object.entries(CITY_CODES)) {
    if (name.includes(input)) return code;
  }
  return '101010100';
}

function resolveMap(input: string | undefined, map: Record<string, string>): string {
  if (!input) return '';
  if (map[input] !== undefined) return map[input];
  for (const [key, val] of Object.entries(map)) {
    if (key.includes(input)) return val;
  }
  return input;
}

// ── CLI registration ─────────────────────────────────────────────────

cli({
  site: 'boss',
  name: 'search',
  description: 'BOSS直聘搜索职位 (直接 HTTP，无需浏览器)',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: false,
  args: [
    { name: 'query', required: true, help: 'Search keyword (e.g. AI agent, 前端)' },
    { name: 'city', default: '北京', help: 'City name or code (e.g. 杭州, 上海)' },
    { name: 'experience', default: '', help: 'Experience: 应届/1-3年/3-5年/5-10年/10年以上' },
    { name: 'degree', default: '', help: 'Degree: 大专/本科/硕士/博士' },
    { name: 'salary', default: '', help: 'Salary: 3-5K/5-10K/10-15K/15-20K/20-30K/30-50K/50K以上' },
    { name: 'industry', default: '', help: 'Industry: 互联网/人工智能/金融/游戏' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['name', 'salary', 'company', 'area', 'experience', 'degree', 'skills', 'boss', 'url'],
  func: async (_page, kwargs) => {
    const cookieHeader = loadCookieHeader();
    const cityCode = resolveCity(kwargs.city);

    const params = new URLSearchParams({
      scene: '1',
      query: kwargs.query,
      city: cityCode,
      page: String(kwargs.page || 1),
      pageSize: '15',
    });
    // Only add non-empty filter params
    const expVal = resolveMap(kwargs.experience, EXP_MAP);
    const degreeVal = resolveMap(kwargs.degree, DEGREE_MAP);
    const salaryVal = resolveMap(kwargs.salary, SALARY_MAP);
    const industryVal = resolveMap(kwargs.industry, INDUSTRY_MAP);
    if (expVal) params.set('experience', expVal);
    if (degreeVal) params.set('degree', degreeVal);
    if (salaryVal) params.set('salary', salaryVal);
    if (industryVal) params.set('industry', industryVal);

    const url = `https://www.zhipin.com/wapi/zpgeek/search/joblist.json?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        ...HEADERS,
        'Cookie': cookieHeader,
        'Referer': `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(kwargs.query)}&city=${cityCode}`,
      },
    });

    if (!resp.ok) throw new Error(`BOSS API HTTP ${resp.status}`);

    const data = await resp.json() as any;
    if (data.code !== 0) {
      if (data.code === 37) {
        // Clear cached cookies so next run re-extracts
        _cachedCookieHeader = null;
        throw new Error(
          'Cookie 已过期。请在 Chrome 中重新登录 www.zhipin.com，然后重试。\n' +
          '如有 boss-cli: boss logout && boss login'
        );
      }
      throw new Error(`BOSS API: ${data.message || 'Unknown'} (code=${data.code})`);
    }

    const zpData = data.zpData || {};
    return (zpData.jobList || []).slice(0, kwargs.limit || 15).map((j: any) => ({
      name: j.jobName,
      salary: j.salaryDesc,
      company: j.brandName,
      area: [j.cityName, j.areaDistrict, j.businessDistrict].filter(Boolean).join('·'),
      experience: j.jobExperience,
      degree: j.jobDegree,
      skills: (j.skills || []).join(','),
      boss: j.bossName + ' · ' + j.bossTitle,
      url: j.encryptJobId ? 'https://www.zhipin.com/job_detail/' + j.encryptJobId + '.html' : '',
    }));
  },
});
