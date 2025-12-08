# -*- coding: utf-8 -*-
"""
免责声明：
1. 本工具仅用于个人学习研究，请遵守夸克网盘和百度网盘的服务条款
2. 请勿用于大规模商业转存或违反平台规则的行为
3. 使用本工具造成的任何账号风险由使用者自行承担
"""
import sys
import json
import time
import base64
import hashlib
import traceback
from pathlib import Path, PurePosixPath
from typing import List, Dict, Any, Optional, Tuple, Set
from concurrent.futures import ThreadPoolExecutor, as_completed

# 百度固定的 Block List
FAKE_BLOCK_LIST_MD5 = ["5910a591dd8fc18c32a8f3df4fdc1761", "a5fc157d78e6ad1c7e114b056c92821e"]

# User-Agent
UA_QUARK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch'
UA_BAIDU = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

CONFIG_FILE = Path("config.json")
DEFAULT_CHUNK_SIZE = 262144  # 256KB
DEFAULT_CONCURRENCY = 3


class UI:
    """提供统一的、带颜色的终端输出体验"""
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

    @staticmethod
    def banner():
        print(f"\n{UI.BLUE}{'='*60}")
        print(f" 🚀 夸克 -> 百度网盘 秒传工具 Q2B")
        print(f"{'='*60}{UI.RESET}")

    @staticmethod
    def success(msg: str):
        print(f"{UI.GREEN}✅ [成功] {msg}{UI.RESET}")

    @staticmethod
    def info(msg: str):
        print(f"{UI.BLUE}ℹ️  [提示] {msg}{UI.RESET}")

    @staticmethod
    def warning(msg: str):
        print(f"{UI.YELLOW}⚠️  [注意] {msg}{UI.RESET}")

    @staticmethod
    def error(msg: str, suggestion: str = ""):
        print(f"{UI.RED}❌ [错误] {msg}{UI.RESET}")
        if suggestion:
            print(f"   ✨ 建议: {suggestion}")

    @staticmethod
    def ask(question: str, default: str = "") -> str:
        prompt = f"❓ {question}"
        if default:
            prompt += f" [默认: {default}]"
        prompt += ": "
        try:
            val = input(prompt).strip()
        except KeyboardInterrupt:
            print("\n")
            sys.exit(0)
        return val if val else default

    @staticmethod
    def ask_yes_no(question: str, default_yes: bool = True) -> bool:
        hint = "Y/n" if default_yes else "y/N"
        while True:
            val = UI.ask(f"{question} ({hint})").lower()
            if not val:
                return default_yes
            if val in ['y', 'yes']:
                return True
            if val in ['n', 'no']:
                return False


try:
    import httpx
except ImportError:
    UI.error("缺少核心组件 'httpx'", "请运行命令: pip install httpx")
    sys.exit(1)

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False


class ConfigManager:
    DEFAULT_SETTINGS = {
        "quark_cookie": "",
        "baidu_cookie": "",
        "target_path": "/Q2B/",
        "concurrency": DEFAULT_CONCURRENCY,
        "chunk_size": DEFAULT_CHUNK_SIZE,
        "verify_ssl": True
    }

    @staticmethod
    def load() -> Dict[str, Any]:
        if not CONFIG_FILE.exists():
            return ConfigManager.DEFAULT_SETTINGS.copy()
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                config = ConfigManager.DEFAULT_SETTINGS.copy()
                config.update(data)
                return config
        except Exception:
            UI.warning("配置文件读取异常，将使用默认设置。")
            return ConfigManager.DEFAULT_SETTINGS.copy()

    @staticmethod
    def save(config: Dict[str, Any]):
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=4, ensure_ascii=False)
            UI.success(f"配置已保存至: {CONFIG_FILE}")
        except Exception as e:
            UI.error(f"保存配置失败: {e}")

    @staticmethod
    def wizard(current_config: Dict[str, Any]) -> Dict[str, Any]:
        print("\n" + "-" * 40)
        print("🛠️  配置向导 (按回车保持当前值)")
        print("-" * 40)
        new_config = current_config.copy()

        # Quark Cookie
        curr_q = "已设置" if new_config['quark_cookie'] else "未设置"
        q_cookie = UI.ask(f"请输入夸克网盘 Cookie (当前: {curr_q})")
        if q_cookie:
            new_config['quark_cookie'] = q_cookie

        # Baidu Cookie
        curr_b = "已设置" if new_config['baidu_cookie'] else "未设置"
        b_cookie = UI.ask(f"请输入百度网盘 Cookie (当前: {curr_b})")
        if b_cookie:
            new_config['baidu_cookie'] = b_cookie

        # Target Path
        path = UI.ask("百度网盘保存路径", new_config['target_path'])
        if not path.startswith('/'):
            path = '/' + path
        if not path.endswith('/'):
            path = path + '/'
        new_config['target_path'] = path

        # Concurrency
        conc = UI.ask("并发线程数 (建议 3-10)", str(new_config['concurrency']))
        if conc.isdigit():
            new_config['concurrency'] = max(1, min(20, int(conc)))

        ConfigManager.save(new_config)
        return new_config


def parse_cookies(cookie_str: str) -> Dict[str, str]:
    cookies = {}
    if not cookie_str:
        return cookies
    for item in cookie_str.split(';'):
        if '=' in item:
            k, v = item.strip().split('=', 1)
            cookies[k] = v
    return cookies


class QuarkClient:
    """夸克网盘客户端"""
    BASE_URL = "https://drive-pc.quark.cn/1/clouddrive"

    def __init__(self, cookie: str, verify_ssl: bool = True):
        headers = {'User-Agent': UA_QUARK, 'Origin': 'https://pan.quark.cn', 'Referer': 'https://pan.quark.cn/'}
        # 根据配置决定是否验证SSL证书
        self.client = httpx.Client(
            headers=headers,
            cookies=parse_cookies(cookie),
            verify=verify_ssl,  # 使用配置的值
            timeout=20.0)

    def close(self):
        try:
            self.client.close()
        except:
            pass

    def check_alive(self) -> bool:
        """测试 Cookie 是否有效"""
        try:
            res = self.list_files("0", page=1, size=1)
            # 检查特有的业务错误码
            if res.get('status') == 401:
                return False
            return True
        except:
            return False

    def list_files(self, parent_id: str, page: int = 1, size: int = 200) -> Dict:
        """获取文件列表（原始 API）"""
        url = f"{self.BASE_URL}/file/sort"
        params = {'pdir_fid': parent_id, '_page': page, '_size': size, '_sort': 'file_name:asc', 'pr': 'ucpro', 'fr': 'pc'}
        try:
            resp = self.client.get(url, params=params)
            return resp.json()
        except Exception as e:
            UI.warning(f"获取列表失败: {e}")
            return {}

    def list_all_recursive(self, parent_id: str, parent_path: str) -> List[Dict]:
        """
        递归获取目录下所有文件
        返回: List[{fid, name, size, path_prefix}]
        """
        results = []
        # 队列存储: (fid, current_relative_path_prefix)
        queue = [(parent_id, parent_path)]

        while queue:
            curr_id, curr_path = queue.pop(0)
            page = 1
            while True:
                data = self.list_files(curr_id, page, 200)
                file_list = data.get('data', {}).get('list', [])
                if not file_list:
                    break

                for item in file_list:
                    name = item['file_name']
                    is_dir = item.get('dir', False) or (item.get('file_type') == 0)
                    if is_dir:
                        new_path = f"{curr_path}{name}/"
                        queue.append((item['fid'], new_path))
                    else:
                        results.append({
                            'fid': item['fid'],
                            'file_name': name,  # 保持与 get_file_info 统一
                            'path': curr_path,  # 相对路径前缀
                            'size': int(item.get('size', 0))
                        })

                if len(file_list) < 200:
                    break
                page += 1
        return results

    def get_file_info(self, fids: List[str]) -> List[Dict]:
        """批量获取文件详情（含下载地址）"""
        url = f"{self.BASE_URL.rstrip('/')}/file/download?pr=ucpro&fr=pc&uc_param_str="
        try:
            resp = self.client.post(url, json={"fids": fids})
            data = resp.json()
            if data.get('code') != 0:
                return []
            return [x for x in data.get('data', []) if not x.get('dir')]
        except Exception as e:
            UI.warning(f"获取文件详情失败: {e}")
            return []

    def get_slice_md5(self, url: str, size: int) -> Optional[str]:
        """获取首分片 MD5 """
        headers = {'Range': f'bytes=0-{size - 1}'}
        try:
            resp = self.client.get(url, headers=headers)
            if resp.status_code in [200, 206]:
                return hashlib.md5(resp.content).hexdigest()
        except:
            pass
        return None

    def download_chunk_b64(self, url: str, offset: int, length: int) -> Optional[str]:
        """下载指定分片并转 Base64 """
        end = offset + length - 1
        headers = {'Range': f'bytes={offset}-{end}'}
        try:
            resp = self.client.get(url, headers=headers)
            if resp.status_code in [200, 206]:
                return base64.b64encode(resp.content).decode('utf-8')
        except:
            pass
        return None


class BaiduClient:
    """百度网盘客户端"""
    PRECREATE = "https://pan.baidu.com/api/precreate"
    RAPID = "https://pan.baidu.com/api/rapidupload"

    def __init__(self, cookie: str, target_root: str, verify_ssl: bool = True):
        headers = {'User-Agent': UA_BAIDU, 'Referer': 'https://pan.baidu.com/disk/main', 'Origin': 'https://pan.baidu.com'}
        self.client = httpx.Client(headers=headers, cookies=parse_cookies(cookie), verify=verify_ssl, timeout=30.0)
        self.target_root = self._normalize_path(target_root)
        self.uk = None
        self.bdstoken = None

    def close(self):
        try:
            self.client.close()
        except:
            pass

    @staticmethod
    def _normalize_path(path: str) -> str:
        """确保路径格式正确"""
        path = path.replace('\\', '/').replace('//', '/')
        if not path.startswith('/'):
            path = '/' + path
        if not path.endswith('/'):
            path = path + '/'
        return path

    def init_user_info(self) -> bool:
        """初始化 UK 和 Token"""
        try:
            resp = self.client.get('https://pan.baidu.com/disk/main')
            import re
            uk = re.search(r'"uk"\s*:\s*"(\d+)"', resp.text)
            token = re.search(r'"bdstoken"\s*:\s*"([a-z0-9]+)"', resp.text)
            if uk and token:
                self.uk = uk.group(1)
                self.bdstoken = token.group(1)
                return True
            # 备用方案：解析 window.locals
            match = re.search(r'window\.locals\s*=\s*({.*?});', resp.text, re.DOTALL)
            if match:
                obj = json.loads(match.group(1).replace("'", '"'))
                self.uk = str(obj.get('uk'))
                self.bdstoken = obj.get('userInfo', {}).get('bdstoken')
                return True
        except Exception as e:
            UI.warning(f"百度初始化失败: {e}")
        return False

    @staticmethod
    def _enc_md5_simulator(md5: str) -> str:
        """
        百度特有的 MD5 变换算法
        """
        temp = md5[8:16] + md5[0:8] + md5[24:32] + md5[16:24]
        res = []
        for i, c in enumerate(temp):
            digit = int(c, 16)
            mask = 15 & i
            res.append(format(digit ^ mask, 'x'))
        result_str = ''.join(res)
        if len(result_str) > 9:
            digit9 = int(result_str[9], 16)
            special_char = chr(digit9 + ord('g'))
            result_str = result_str[:9] + special_char + result_str[10:]
        return result_str

    @staticmethod
    def calculate_offset(uk: str, md5: str, ts: int, size: int, chunk_size: int) -> int:
        """计算验证分片的偏移量"""
        enc_md5 = BaiduClient._enc_md5_simulator(md5)
        hex_str = hashlib.md5(f"{uk}{enc_md5}{ts}".encode()).hexdigest()[:8]
        max_offset = size - chunk_size
        if max_offset < 0:
            return 0
        return int(hex_str, 16) % (max_offset + 1)

    def pre_create(self, relative_path: str, filename: str, size: int) -> Optional[str]:
        """预创建文件"""
        full_path = f"{self.target_root}{relative_path}{filename}".replace('//', '/')
        params = {'bdstoken': self.bdstoken, 'app_id': '250528', 'channel': 'chunlei', 'web': '1', 'clienttype': '0'}
        data = {
            'path': full_path,
            'autoinit': '1',
            'block_list': json.dumps(FAKE_BLOCK_LIST_MD5),  # 假的 block list
            'target_path': str(PurePosixPath(full_path).parent) + '/'
        }
        try:
            resp = self.client.post(self.PRECREATE, params=params, data=data)
            js = resp.json()
            if js.get('errno') == 0:
                return js.get('uploadid')
        except:
            pass
        return None

    def rapid_upload(self, upload_id: str, file_info: Dict, slice_md5: str, chunk_b64: str, offset: int, ts: int,
                     relative_path: str) -> Tuple[bool, str]:
        """执行秒传 (返回: success, msg)"""
        full_path = f"{self.target_root}{relative_path}{file_info['file_name']}".replace('//', '/')
        params = {'rtype': '1', 'bdstoken': self.bdstoken, 'app_id': '250528', 'channel': 'chunlei', 'web': '1', 'clienttype': '0'}

        enc_content = self._enc_md5_simulator(file_info['md5'])
        enc_slice = self._enc_md5_simulator(slice_md5)

        data = {
            'uploadid': upload_id,
            'path': full_path,
            'content-length': str(file_info['size']),
            'content-md5': enc_content,
            'slice-md5': enc_slice,
            'target_path': str(PurePosixPath(full_path).parent) + '/',
            'local_mtime': str(ts),
            'data_time': str(ts),
            'data_offset': str(offset),
            'data_content': chunk_b64
        }
        try:
            resp = self.client.post(self.RAPID, params=params, data=data)
            js = resp.json()
            errno = js.get('errno')
            if errno == 0:
                return True, "Success"

            return False, f"Err {errno}"
        except Exception as e:
            return False, str(e)[:30]


def file_browser_tui(quark: QuarkClient) -> Tuple[Set[str], Set[str], Dict[str, str]]:
    """
    交互式文件选择器
    返回: (selected_files_set, selected_dirs_set, fid_to_relpath_map)
    """
    try:
        from prompt_toolkit.application import Application
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.layout import Layout, HSplit, Window
        from prompt_toolkit.layout.controls import FormattedTextControl
        from prompt_toolkit.styles import Style
    except ImportError:
        UI.error("缺少 prompt_toolkit", "pip install prompt_toolkit")
        return set(), set(), {}

    current_fid = "0"
    current_path = "/"
    path_stack = []
    items = []
    selected_files = set()
    selected_dirs = set()  # 仅标记用户显式选择的目录
    fid_to_relpath = {}  # fid -> 相对路径前缀
    recursive_added = {}  # dir_fid -> set(file_fids)

    cursor = 0
    top_line = 0
    status_msg = "加载中..."

    def fetch_dir():
        nonlocal items, status_msg, cursor, top_line
        status_msg = "⏳ 数据加载中..."
        try:
            # 自动拉取所有页，避免滚动时卡顿
            all_items = []
            page = 1
            while True:
                data = quark.list_files(current_fid, page=page, size=200)
                lst = data.get('data', {}).get('list', [])
                if not lst:
                    break
                for x in lst:
                    is_d = x.get('dir', False) or (x.get('file_type') == 0)
                    all_items.append({'fid': x['fid'], 'name': x['file_name'], 'is_dir': is_d, 'size': x.get('size', 0)})
                if len(lst) < 200:
                    break
                page += 1

            all_items.sort(key=lambda x: (not x['is_dir'], x['name']))
            items = all_items
            status_msg = f"已选文件: {len(selected_files)} | 递归目录: {len(recursive_added)}"
            if cursor >= len(items):
                cursor = max(0, len(items) - 1)
        except Exception as e:
            status_msg = f"Error: {e}"
            items = []

    def get_render_text():
        fragments = []
        fragments.append(('class:title', f" 📁 夸克网盘 | 路径: {current_path}\n"))
        fragments.append(('class:help', " [↑↓]移动 [Enter]进入 [Backspace]返回 [空格]选择 [r]递归目录 [s]确认\n\n"))

        visible_h = 15
        start = top_line
        end = min(len(items), start + visible_h)

        for idx in range(start, end):
            item = items[idx]
            fid = item['fid']
            is_sel = fid in selected_files

            prefix = "[ ]"
            if item['is_dir']:
                icon = "📁"
                if fid in selected_dirs:
                    prefix = "[D]"
                if fid in recursive_added:
                    icon = "🔁"  # 递归标记
            else:
                icon = "📄"
                if is_sel:
                    prefix = "[✓]"

            style = 'class:cursor' if idx == cursor else ''
            # Size str
            sz = ""
            if not item['is_dir']:
                s = item['size']
                if s > 1024**3:
                    sz = f"({s/1024**3:.1f}GB)"
                elif s > 1024**2:
                    sz = f"({s/1024**2:.1f}MB)"
                elif s > 1024:
                    sz = f"({s/1024:.0f}KB)"
                else:
                    sz = f"({s:.0f}B)"

            txt = f" {prefix} {icon} {item['name']} {sz}"
            fragments.append((style, txt + '\n'))

        fragments.append(('class:status', f"\n ℹ️  {status_msg}"))
        return fragments

    kb = KeyBindings()

    @kb.add('up')
    def _(event):
        nonlocal cursor, top_line
        cursor = max(0, cursor - 1)
        if cursor < top_line:
            top_line = cursor

    @kb.add('down')
    def _(event):
        nonlocal cursor, top_line
        cursor = min(len(items) - 1, cursor + 1)
        if cursor >= top_line + 15:
            top_line = cursor - 14

    @kb.add('right')
    @kb.add('enter')
    def _(event):
        nonlocal current_fid, current_path, cursor, top_line
        if not items:
            return
        it = items[cursor]
        if it['is_dir']:
            path_stack.append((current_fid, current_path))
            current_fid = it['fid']
            current_path = (current_path.rstrip('/') + '/' + it['name'] + '/')
            cursor = 0
            top_line = 0
            fetch_dir()

    @kb.add('left')
    @kb.add('backspace')
    def _(event):
        nonlocal current_fid, current_path, cursor, top_line
        if path_stack:
            current_fid, current_path = path_stack.pop()
            cursor = 0
            top_line = 0
            fetch_dir()

    @kb.add(' ')
    def _(event):
        nonlocal status_msg
        if not items:
            return
        it = items[cursor]
        fid = it['fid']
        rel = (current_path.rstrip('/') + '/')  # 当前目录的相对前缀

        if it['is_dir']:
            if fid in selected_dirs:
                selected_dirs.remove(fid)
                if fid in fid_to_relpath:
                    del fid_to_relpath[fid]
            else:
                selected_dirs.add(fid)
                # 记录该目录相对于根的路径，以便后续展开
                fid_to_relpath[fid] = rel + it['name'] + '/'
        else:
            if fid in selected_files:
                selected_files.remove(fid)
                # 如果不是递归添加的，移除路径映射
                if fid in fid_to_relpath and fid_to_relpath[fid] == rel:
                    del fid_to_relpath[fid]
            else:
                selected_files.add(fid)
                fid_to_relpath[fid] = rel  # 记录文件所在的路径

        status_msg = f"已选文件: {len(selected_files)} (按 s 确认)"

    @kb.add('r')
    def _(event):
        nonlocal status_msg
        if not items:
            return
        it = items[cursor]
        if not it['is_dir']:
            status_msg = "🚫 仅文件夹可使用递归 (r)"
            return

        dir_fid = it['fid']
        # 计算该文件夹的相对路径前缀
        dir_rel_path = (current_path.rstrip('/') + '/' + it['name'] + '/')

        if dir_fid in recursive_added:
            # 取消递归
            fids_to_remove = recursive_added.pop(dir_fid)
            for f in fids_to_remove:
                if f in selected_files:
                    selected_files.remove(f)
                if f in fid_to_relpath:
                    del fid_to_relpath[f]
            status_msg = f"已取消递归: {it['name']}"
        else:
            # 执行递归
            status_msg = f"⏳ 正在扫描: {it['name']}..."
            event.app.invalidate()  # 强制刷新显示状态
            try:
                # 使用 list_all_recursive 获取该目录下所有文件
                # 注意：list_all_recursive 需要传入相对该目录的基准，但我们希望保持全局相对路径
                # 所以我们手动拼接前缀
                files = quark.list_all_recursive(dir_fid, dir_rel_path)
                added_fids = set()
                for f in files:
                    fid = f['fid']
                    selected_files.add(fid)
                    fid_to_relpath[fid] = f['path']  # 这里的path已经是包含完整相对路径的了
                    added_fids.add(fid)
                recursive_added[dir_fid] = added_fids
                status_msg = f"递归添加了 {len(added_fids)} 个文件"
            except Exception as e:
                status_msg = f"递归失败: {e}"

    @kb.add('s')
    def _(event):
        event.app.exit(result=(selected_files, selected_dirs, fid_to_relpath))

    @kb.add('c-c')
    def _(event):
        event.app.exit(result=(set(), set(), {}))

    style = Style.from_dict({'title': '#ffffff bg:#444444 bold', 'help': '#00ffff', 'cursor': '#ffffff bg:#00aa00', 'status': '#888888 italic'})

    fetch_dir()
    app = Application(layout=Layout(HSplit([Window(FormattedTextControl(get_render_text))])), key_bindings=kb, style=style, full_screen=True)
    return app.run()


def process_single_task(file_info: Dict, config: Dict, uk: str, bdstoken: str) -> Dict:
    """单个文件处理逻辑 (融合版)"""
    res = {'name': file_info['file_name'], 'status': 'fail', 'msg': ''}

    # 每个线程独立实例化客户端，避免并发冲突
    q_client = None
    b_client = None

    try:
        q_client = QuarkClient(config['quark_cookie'], verify_ssl=config['verify_ssl'])
        b_client = BaiduClient(config['baidu_cookie'], config['target_path'], verify_ssl=config['verify_ssl'])
        b_client.uk = uk
        b_client.bdstoken = bdstoken

        # 1. 夸克：获取首分片 MD5
        slice_md5 = q_client.get_slice_md5(file_info['download_url'], config['chunk_size'])
        if not slice_md5:
            res['msg'] = "分片MD5获取失败"
            return res

        # 2. 百度：预创建 (传入相对路径前缀)
        upload_id = b_client.pre_create(file_info['path'], file_info['file_name'], file_info['size'])
        if not upload_id:
            res['msg'] = "预创建失败"
            return res

        # 3. 核心计算：Offset 和 下载分片
        ts = int(time.time())
        offset = BaiduClient.calculate_offset(uk, file_info['md5'], ts, file_info['size'], config['chunk_size'])

        chunk_b64 = q_client.download_chunk_b64(file_info['download_url'], offset, config['chunk_size'])
        if not chunk_b64:
            res['msg'] = "下载验证分片失败"
            return res

        # 4. 百度：秒传请求
        success, msg = b_client.rapid_upload(upload_id, file_info, slice_md5, chunk_b64, offset, ts, file_info['path'])

        if success:
            res['status'] = 'success'
        else:
            res['msg'] = f"秒传失败: {msg}"

    except Exception as e:
        res['msg'] = f"异常: {str(e)[:50]}"
    finally:
        if q_client:
            q_client.close()
        if b_client:
            b_client.close()

    return res


# ==========================================
# 主程序
# ==========================================


def main():
    UI.banner()
    config = ConfigManager.load()

    # 1. 配置检查与引导
    if not config['quark_cookie'] or not config['baidu_cookie']:
        UI.warning("检测到配置缺失，进入设置向导...")
        config = ConfigManager.wizard(config)

    # 2. 验证夸克连接
    UI.info("正在连接夸克网盘...")
    q = QuarkClient(config['quark_cookie'], verify_ssl=config['verify_ssl'])
    if not q.check_alive():
        UI.error("夸克网盘 Cookie 无效或已过期")
        if UI.ask_yes_no("是否重新配置?", True):
            config = ConfigManager.wizard(config)
            q = QuarkClient(config['quark_cookie'], verify_ssl=config['verify_ssl'])  # Re-init
            if not q.check_alive():
                UI.error("依然无法连接，请检查 Cookie 是否正确复制")
                return
        else:
            return

    # 3. 验证百度连接
    UI.info("正在连接百度网盘...")
    b_test = BaiduClient(config['baidu_cookie'], config['target_path'], verify_ssl=config['verify_ssl'])

    if not b_test.init_user_info():
        UI.error("百度网盘 Cookie 无效")
        if UI.ask_yes_no("是否重新配置?", True):
            config = ConfigManager.wizard(config)
            b_test = BaiduClient(config['baidu_cookie'], config['target_path'], verify_ssl=config['verify_ssl'])
            if not b_test.init_user_info():
                return
        else:
            return
    UI.success(f"百度连接成功 (UK: {b_test.uk})")
    uk, bdstoken = b_test.uk, b_test.bdstoken
    b_test.close()

    # 4. 启动文件选择器
    UI.info("正在启动文件浏览器 (空格选择/取消，r 递归目录，s 确认)...")
    time.sleep(1)

    sel_files, sel_dirs, fid_map = file_browser_tui(q)

    # 处理逻辑：
    # sel_files 包含了单独选的文件 + 递归展开的文件
    # sel_dirs 包含了用户想选但还没展开的目录 -> 需要在这里展开

    final_task_fids = list(sel_files)

    # 展开手动选择的目录
    if sel_dirs:
        UI.info(f"正在展开 {len(sel_dirs)} 个目录...")
        for d_fid in sel_dirs:
            rel_prefix = fid_map.get(d_fid, '/')
            # 使用递归方法获取目录下所有文件
            sub_files = q.list_all_recursive(d_fid, rel_prefix)
            for sub in sub_files:
                fid = sub['fid']
                if fid not in final_task_fids:
                    final_task_fids.append(fid)
                    fid_map[fid] = sub['path']  # 更新路径映射

    if not final_task_fids:
        UI.warning("未选择任何文件，程序退出")
        return

    # 5. 批量获取文件详情（下载地址等）
    UI.info(f"正在获取 {len(final_task_fids)} 个文件的详细信息...")
    tasks_info = []

    # 分批获取以防 URL 过长
    BATCH_SIZE = 100
    for i in range(0, len(final_task_fids), BATCH_SIZE):
        batch = final_task_fids[i:i + BATCH_SIZE]
        infos = q.get_file_info(batch)

        for item in infos:
            fid = item['fid']
            # 注入路径信息
            item['path'] = fid_map.get(fid, '/')
            tasks_info.append(item)

    q.close()

    if not tasks_info:
        UI.error("无法获取文件详情，可能被风控或 Cookie 失效")
        return

    chunk_size = config.get('chunk_size', DEFAULT_CHUNK_SIZE)
    filtered_tasks = []
    skipped_tasks = []

    for task in tasks_info:
        if task['size'] < chunk_size:
            skipped_tasks.append({'name': task['file_name'], 'size': task['size'], 'reason': f"文件大小({task['size']}B)小于分片大小({chunk_size}B)"})
        else:
            filtered_tasks.append(task)

    # 显示跳过信息
    if skipped_tasks:
        UI.warning(f"跳过了 {len(skipped_tasks)} 个文件（大小小于 {chunk_size}B）:")
        for i, skipped in enumerate(skipped_tasks[:5]):  # 只显示前5个，避免太多
            size_str = f"{skipped['size']}B" if skipped['size'] < 1024 else f"{skipped['size']/1024:.1f}KB"
            print(f"   • {skipped['name']} ({size_str}) - {skipped['reason']}")
        if len(skipped_tasks) > 5:
            print(f"   • ... 等 {len(skipped_tasks)-5} 个文件")

    # 更新任务列表
    tasks_info = filtered_tasks
    if not tasks_info:
        UI.warning("所有文件都被跳过，没有可传输的文件")
        return

    total_size = sum(t['size'] for t in tasks_info)
    UI.info(f"准备就绪 | 文件数: {len(tasks_info)} | 总大小: {total_size/1024/1024:.2f} MB")

    if not UI.ask_yes_no("开始秒传?", True):
        return

    # 6. 执行并发转存
    results = []
    with ThreadPoolExecutor(max_workers=config['concurrency']) as executor:
        futures = {executor.submit(process_single_task, t, config, uk, bdstoken): t for t in tasks_info}

        if HAS_TQDM:
            pbar = tqdm(total=len(tasks_info), unit="file")

        for future in as_completed(futures):
            res = future.result()
            results.append(res)

            if HAS_TQDM:
                pbar.update(1)
                pbar.set_postfix(status=res['status'])
            else:
                symbol = "✅" if res['status'] == 'success' else "❌"
                print(f"{symbol} {res['name']}: {res['msg']}")

        if HAS_TQDM:
            pbar.close()

    # 7. 结果摘要
    success_cnt = sum(1 for r in results if r['status'] == 'success')
    fail_cnt = len(results) - success_cnt

    print("\n")
    UI.info(f"任务结束 | 成功: {success_cnt} | 失败: {fail_cnt}")

    if fail_cnt > 0:
        UI.warning("失败文件详情:")
        for r in results:
            if r['status'] != 'success':
                print(f"   • {r['name']} -> {r['msg']}")
        UI.info("提示: '秒传失败' 通常表示百度网盘云端无此文件，或需要等待片刻重试。")

    input("\n按回车键退出...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 用户中断，已退出")
    except Exception as e:
        UI.error(f"发生意外错误: {e}")
        traceback.print_exc()
