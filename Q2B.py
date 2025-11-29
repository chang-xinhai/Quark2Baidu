"""
免责声明：
1. 本工具仅用于个人学习研究，请遵守夸克网盘和百度网盘的服务条款
2. 请勿用于大规模商业转存或违反平台规则的行为
3. 使用本工具造成的任何账号风险由使用者自行承担
"""
import os
import sys
import time
import json
import re
import logging
import hashlib
import base64
from urllib.parse import quote
from typing import List, Dict, Optional, Tuple, Union

# --- 第三方库依赖检查 ---
try:
    import requests
    import httpx
except ImportError:
    print("错误: 缺少必要依赖。请运行: pip install requests httpx")
    sys.exit(1)

# Curses (Windows 需要 windows-curses)
try:
    import curses
except ImportError:
    curses = None
    if os.name == 'nt':
        print("提示: Windows 用户若想使用交互界面，请安装: pip install windows-curses")

# --- 日志配置 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger(__name__)

# --- 常量 ---
UA_BAIDU = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
UA_QUARK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch'


# ==========================================
# 工具类
# ==========================================
class Utils:

    @staticmethod
    def parse_cookie_str(cookie_str: str) -> Dict[str, str]:
        cookies = {}
        if not cookie_str:
            return cookies
        for pair in cookie_str.split(';'):
            if '=' in pair:
                k, v = pair.split('=', 1)
                cookies[k.strip()] = v.strip()
        return cookies

    @staticmethod
    def safe_str_width(text: str, max_width: int) -> str:
        """
        简单截断字符串以适应屏幕宽度。
        注意：curses处理中文字符宽度较麻烦，这里做简单处理：
        预留足够空间，防止切断宽字符导致乱码。
        """
        if len(text) > max_width:
            return text[:max_width - 3] + "..."
        return text


# ==========================================
# 夸克网盘 API (用于下载/转存逻辑)
# ==========================================
class QuarkPan:
    BASE = "https://drive-pc.quark.cn/1/clouddrive"

    def __init__(self, cookie_str: str, timeout: float = 20.0):
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': UA_QUARK, 'Origin': 'https://pan.quark.cn', 'Referer': 'https://pan.quark.cn/',})
        self.session.cookies.update(Utils.parse_cookie_str(cookie_str))
        self.timeout = timeout

    def get_file_info(self, fids: List[str]) -> List[Dict]:
        """获取文件下载详情"""
        url = f"{self.BASE.rstrip('/')}/file/download?pr=ucpro&fr=pc&uc_param_str="
        try:
            resp = self.session.post(url, json={"fids": fids}, timeout=self.timeout)
            resp.raise_for_status()
            j = resp.json()
            if j.get('status') == 200 and j.get('code') == 0:
                out = []
                for d in j.get('data', []):
                    out.append({
                        'file_name': d.get('file_name'),
                        'download_url': d.get('download_url'),
                        'md5': d.get('md5'),
                        'size': int(d.get('size', 0))
                    })
                return out
            logger.error("夸克 API 返回错误: %s", j)
        except Exception as e:
            logger.error("获取夸克文件信息失败: %s", e)
        return []

    def get_slice_md5(self, download_url: str) -> Optional[str]:
        """下载前256KB并计算MD5 (用于百度秒传校验)"""
        headers = {'Range': 'bytes=0-262143'}
        try:
            # logger.info("计算 slice md5 (前256KB)...")
            resp = self.session.get(download_url, headers=headers, timeout=self.timeout, stream=True)
            if resp.status_code in (200, 206):
                data = resp.raw.read(262144)
                return hashlib.md5(data).hexdigest()
            logger.error("Slice 下载失败 Status: %s", resp.status_code)
        except Exception as e:
            logger.error("Slice MD5 计算异常: %s", e)
        return None

    def download_chunk_base64(self, download_url: str, offset: int, length: int) -> Optional[str]:
        """下载特定偏移量的分片并转 Base64 (用于百度秒传校验)"""
        end = offset + length - 1
        headers = {'Range': f'bytes={offset}-{end}'}
        try:
            # logger.info("下载验证分片 Offset=%d, Len=%d", offset, length)
            resp = self.session.get(download_url, headers=headers, timeout=self.timeout)
            if resp.status_code in (200, 206):
                return base64.b64encode(resp.content).decode('utf-8')
            logger.error("Chunk 下载失败 Status: %s", resp.status_code)
        except Exception as e:
            logger.error("Chunk 下载异常: %s", e)
        return None


# ==========================================
# 百度网盘 API (用于秒传)
# ==========================================
class BaiduPan:

    def __init__(self, cookie_str: str):
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': UA_BAIDU, 'Referer': 'https://pan.baidu.com/disk/main', 'Origin': 'https://pan.baidu.com'})
        self.session.cookies.update(Utils.parse_cookie_str(cookie_str))
        self.uk = None
        self.bdstoken = None

    def init_user_info(self) -> bool:
        """获取 uk 和 bdstoken"""
        try:
            resp = self.session.get('https://pan.baidu.com/disk/main', timeout=10)
            # 方案 A: 正则直接匹配
            uk_match = re.search(r'"uk"\s*:\s*"(\d+)"', resp.text)
            token_match = re.search(r'"bdstoken"\s*:\s*"([a-z0-9]+)"', resp.text)

            if uk_match and token_match:
                self.uk = uk_match.group(1)
                self.bdstoken = token_match.group(1)
                logger.info("百度用户初始化成功: uk=%s", self.uk)
                return True

            # 方案 B: 解析 window.locals
            match = re.search(r'window\.locals\s*=\s*({.*?});', resp.text, re.DOTALL)
            if match:
                data = json.loads(match.group(1).replace("'", '"'))
                self.uk = str(data.get('uk'))
                self.bdstoken = data.get('userInfo', {}).get('bdstoken')
                logger.info("百度用户初始化成功 (Method B): uk=%s", self.uk)
                return True

            logger.error("无法获取百度 uk 或 bdstoken，请检查 Cookie 是否失效")
        except Exception as e:
            logger.error("初始化百度信息异常: %s", e)
        return False

    def pre_create(self, filename: str, block_list: List[str], size: int) -> Optional[str]:
        """秒传第一步：预创建"""
        url = "https://pan.baidu.com/api/precreate"
        params = {'bdstoken': self.bdstoken, 'app_id': '250528', 'channel': 'chunlei', 'web': '1', 'clienttype': '0'}
        data = {'path': quote(f"/{filename}"), 'autoinit': '1', 'block_list': json.dumps(block_list), 'size': str(size), 'isdir': '0'}
        try:
            resp = self.session.post(url, params=params, data=data, timeout=30)
            js = resp.json()
            if js.get('errno') == 0:
                return js.get('uploadid')
            logger.warning("pre_create 失败 (errno=%s): %s", js.get('errno'), js)
        except Exception as e:
            logger.error("pre_create 请求异常: %s", e)
        return None

    @staticmethod
    def _enc_md5_simulator(md5: str) -> str:
        """模拟百度前端的 MD5 变换逻辑"""
        temp = md5[8:16] + md5[0:8] + md5[24:32] + md5[16:24]
        res = []
        for i, c in enumerate(temp):
            digit = int(c, 16)
            mask = 15 & i
            res.append(format(digit ^ mask, 'x'))
        result_str = ''.join(res)
        # 特殊字符替换
        if len(result_str) > 9:
            digit9 = int(result_str[9], 16)
            special_char = chr(digit9 + ord('g'))
            result_str = result_str[:9] + special_char + result_str[10:]
        return result_str

    @staticmethod
    def calculate_offset(uk: str, md5: str, ts: int, size: int) -> int:
        """计算校验分片的 Offset"""
        enc_md5 = BaiduPan._enc_md5_simulator(md5)
        hex_str = hashlib.md5(f"{uk}{enc_md5}{ts}".encode()).hexdigest()[:8]
        # 确保 offset 不会越界 (文件末尾至少留出 256KB)
        # 注意：如果文件小于 256KB，这里逻辑需要调整，但秒传通常针对大文件
        max_offset = size - 262144
        if max_offset < 0:
            return 0
        return int(hex_str, 16) % (max_offset + 1)

    def rapid_upload(self, uploadid: str, file_info: Dict, slice_md5: str, data_content: str, data_offset: int, data_time: int):
        """秒传第二步：上传验证"""
        url = "https://pan.baidu.com/api/rapidupload"
        params = {'rtype': '1', 'bdstoken': self.bdstoken, 'app_id': '250528', 'channel': 'chunlei', 'web': '1', 'clienttype': '0'}
        enc_content_md5 = self._enc_md5_simulator(file_info['md5'])
        enc_slice_md5 = self._enc_md5_simulator(slice_md5)

        data = {
            'uploadid': uploadid,
            'path': f"/{file_info['file_name']}",
            'content-length': str(file_info['size']),
            'content-md5': enc_content_md5,
            'slice-md5': enc_slice_md5,
            'local_mtime': str(data_time),
            'data_time': str(data_time),
            'data_offset': str(data_offset),
            'data_content': data_content
        }
        try:
            resp = self.session.post(url, params=params, data=data, timeout=60)
            js = resp.json()
            if js.get('errno') == 0:
                logger.info("✅ 秒传成功: %s", file_info['file_name'])
                return True
            else:
                logger.error("❌ 秒传失败 (errno=%s): %s", js.get('errno'), js)
                return False
        except Exception as e:
            logger.error("秒传请求异常: %s", e)
            return False


# ==========================================
# 交互式浏览器组件
# ==========================================
class QuarkBrowserAPI:
    """专门用于浏览器的轻量级 API"""
    BASE_URL = "https://drive-pc.quark.cn/1/clouddrive"

    def __init__(self, cookie: str):
        self.client = httpx.Client(timeout=10.0)
        self.default_headers = {'User-Agent': UA_QUARK, 'Origin': 'https://pan.quark.cn', 'Referer': 'https://pan.quark.cn/', 'Cookie': cookie}

    def list_files(self, folder_id: str = "0", page: int = 1, size: int = 200) -> Dict:
        url = f"{self.BASE_URL}/file/sort"
        params = {'pdir_fid': folder_id, '_page': page, '_size': size, '_sort': 'file_name:asc', 'pr': 'ucpro', 'fr': 'pc'}
        resp = self.client.get(url, params=params, headers=self.default_headers)
        return resp.json()


class CursesBrowser:

    def __init__(self, api: QuarkBrowserAPI):
        self.api = api
        self.current_fid = "0"
        self.current_path = "/"
        self.path_stack = []  # [(fid, name), ...]

        self.items = []
        self.selected_fids = set()  # 存储选中的 fid

        # 界面状态
        self.cursor = 0  # 当前选中的绝对索引
        self.top_line = 0  # 屏幕显示的起始索引
        self.status_msg = ""

        # 分页
        self.page = 1
        self.page_size = 200

    def fetch_current_dir(self):
        """获取当前目录数据"""
        try:
            self.status_msg = "加载中..."
            data = self.api.list_files(self.current_fid, self.page, self.page_size)
            raw_list = data.get('data', {}).get('list', [])

            parsed = []
            for item in raw_list:
                fid = item.get('fid')
                name = item.get('file_name', 'Unknown')
                # 判断是否文件夹: dir=True 或者 file_type=0
                is_dir = item.get('dir', False) or (item.get('file_type') == 0)
                parsed.append({'fid': fid, 'name': name, 'is_dir': is_dir, 'size': item.get('size', 0)})

            # 排序：文件夹在前，文件在后
            parsed.sort(key=lambda x: (not x['is_dir'], x['name']))
            self.items = parsed

            # 修正光标位置
            if self.cursor >= len(self.items):
                self.cursor = max(0, len(self.items) - 1)
            self.status_msg = f"加载完成 (共 {len(self.items)} 项)"

        except Exception as e:
            self.status_msg = f"错误: {str(e)}"
            self.items = []

    def enter_folder(self):
        if not self.items:
            return
        item = self.items[self.cursor]
        if item['is_dir']:
            self.path_stack.append((self.current_fid, self.current_path))
            self.current_fid = item['fid']
            self.current_path = item['name']
            self.cursor = 0
            self.top_line = 0
            self.page = 1
            self.fetch_current_dir()
        else:
            self.status_msg = "这不是文件夹"

    def go_up(self):
        if not self.path_stack:
            self.status_msg = "已经是根目录"
            return
        fid, name = self.path_stack.pop()
        self.current_fid = fid
        self.current_path = name
        self.cursor = 0
        self.top_line = 0
        self.page = 1
        self.fetch_current_dir()

    def toggle_select(self):
        if not self.items:
            return
        item = self.items[self.cursor]
        if item['is_dir']:
            self.status_msg = "只能选择文件，不能选择文件夹"
            return

        fid = item['fid']
        if fid in self.selected_fids:
            self.selected_fids.remove(fid)
        else:
            self.selected_fids.add(fid)

    def run(self) -> List[str]:
        if curses is None:
            raise RuntimeError("Curses 库不可用")
        return curses.wrapper(self._main_loop)

    def _main_loop(self, stdscr):
        # 初始化设置
        curses.curs_set(0)  # 隐藏光标
        curses.use_default_colors()
        stdscr.timeout(100)  # 100ms 刷新一次输入

        self.fetch_current_dir()

        while True:
            stdscr.erase()
            height, width = stdscr.getmaxyx()

            # --- 1. 绘制标题栏 ---
            path_str = self.current_path
            if len(self.path_stack) > 0 and path_str != '/':
                # 构建面包屑路径的简化版
                path_str = "/".join([n for _, n in self.path_stack[-2:]]) + "/" + path_str

            title = f"夸克网盘 | 路径: /{path_str}"
            info = f"已选: {len(self.selected_fids)} | 按 's' 确认转存"

            # 保证标题不超出宽度
            header = f"{title:<{width-25}} {info}"
            try:
                stdscr.addstr(0, 0, Utils.safe_str_width(header, width), curses.A_REVERSE)
            except curses.error:
                pass

            # --- 2. 绘制列表内容 ---
            list_h = height - 2  # 减去标题和状态栏

            # 计算滚动视窗
            if self.cursor < self.top_line:
                self.top_line = self.cursor
            elif self.cursor >= self.top_line + list_h:
                self.top_line = self.cursor - list_h + 1

            # 绘制可视区域内的项目
            for idx in range(list_h):
                item_idx = self.top_line + idx
                if item_idx >= len(self.items):
                    break

                item = self.items[item_idx]
                is_selected = item['fid'] in self.selected_fids
                is_current = (item_idx == self.cursor)

                # 图标
                icon = "[DIR ]" if item['is_dir'] else ("[ √ ]" if is_selected else "[   ]")
                name = Utils.safe_str_width(item['name'], width - 10)

                line_str = f" {icon} {name}"

                style = curses.A_NORMAL
                if is_current:
                    style |= curses.A_STANDOUT

                try:
                    stdscr.addstr(idx + 1, 0, line_str, style)
                except curses.error:
                    pass

            # --- 3. 绘制底部状态栏 ---
            help_text = "↑/↓:移动 | Enter:进入 | Space:选择 | Backspace:返回 | q:退出 | s:确认转存"
            status_line = f"{self.status_msg} | {help_text}"
            try:
                # 必须减1防止写到右下角最后一个点导致报错
                stdscr.addstr(height - 1, 0, Utils.safe_str_width(status_line, width - 1), curses.A_DIM)
            except curses.error:
                pass

            stdscr.refresh()

            # --- 4. 输入处理 ---
            try:
                key = stdscr.getch()
            except KeyboardInterrupt:
                return []

            if key == -1:
                continue

            if key in (curses.KEY_UP, ord('k')):
                self.cursor = max(0, self.cursor - 1)

            elif key in (curses.KEY_DOWN, ord('j')):
                self.cursor = min(len(self.items) - 1, self.cursor + 1)

            elif key in (curses.KEY_ENTER, 10, 13):
                self.enter_folder()

            elif key in (ord(' '),):
                self.toggle_select()

            elif key in (curses.KEY_BACKSPACE, 127, 8, curses.KEY_LEFT, ord('h')):
                self.go_up()

            elif key in (ord('q'), 27):  # q 或 ESC
                return []

            elif key in (ord('s'),):  # 确认
                if not self.selected_fids:
                    self.status_msg = "未选择任何文件！"
                else:
                    return list(self.selected_fids)


def simple_text_select(api: QuarkBrowserAPI) -> List[str]:
    """Curses 不可用时的备用文本交互"""
    print("\n--- 简易文件选择模式 ---")
    current_fid = "0"
    while True:
        try:
            res = api.list_files(current_fid, size=50)
            items = res.get('data', {}).get('list', [])
            if not items:
                print("目录为空或获取失败。")
                return []

            print(f"\n当前 FID: {current_fid}")
            valid_items = []
            for i, it in enumerate(items):
                is_dir = it.get('dir') or (it.get('file_type') == 0)
                tag = "DIR" if is_dir else "FILE"
                print(f"[{i:2d}] [{tag}] {it['file_name']}")
                valid_items.append(it)

            cmd = input("\n输入序号(进入目录/选择文件), b(返回上级), q(退出), s(结算选中的文件ID): ").strip()

            if cmd == 'q':
                return []
            if cmd == 'b':
                print("简易模式暂不支持记录路径回退，请重新运行或使用FID列表。")
                current_fid = "0"
                continue

            # 这里简化逻辑，只支持单次进入或打印ID
            if cmd.isdigit():
                idx = int(cmd)
                if 0 <= idx < len(valid_items):
                    target = valid_items[idx]
                    is_dir = target.get('dir') or (target.get('file_type') == 0)
                    if is_dir:
                        current_fid = target['fid']
                    else:
                        print(f"已选中: {target['file_name']} (ID: {target['fid']})")
                        return [target['fid']]
            else:
                print("无效指令")

        except Exception as e:
            print(f"出错: {e}")
            return []


# ==========================================
# 主流程
# ==========================================


def main():
    print("=== 夸克 -> 百度网盘 秒传转存工具 ===")

    # 1. 获取 Quark Cookie
    quark_cookie = ''
    if not quark_cookie:
        print("\n请输入夸克 Cookie (document.cookie):")
        quark_cookie = input("Quark Cookie: ").strip()
        if not quark_cookie:
            print("未输入 Cookie，程序退出。")
            sys.exit(0)

    # 2. 选择文件
    print("\n正在进入文件选择界面...")
    fids = []

    browser_api = QuarkBrowserAPI(quark_cookie)

    if curses:
        try:
            browser = CursesBrowser(browser_api)
            fids = browser.run()
        except Exception as e:
            logger.error("Curses 界面运行失败，切换至简易模式: %s", e)
            fids = simple_text_select(browser_api)
    else:
        print("Curses 模块未安装，使用简易文本模式。")
        fids = simple_text_select(browser_api)

    if not fids:
        print("未选择任何文件，程序退出。")
        sys.exit(0)

    print(f"\n已选择 {len(fids)} 个文件，准备转存。")

    # 3. 获取 Baidu Cookie 并开始转存
    baidu_cookie = ''
    if not baidu_cookie:
        print("\n请输入百度网盘 Cookie:")
        baidu_cookie = input("Baidu Cookie: ").strip()
        if not baidu_cookie:
            print("未输入百度 Cookie，无法转存。")
            sys.exit(1)

    print("\n--- 开始转存任务 ---")

    quark_pan = QuarkPan(quark_cookie)
    baidu_pan = BaiduPan(baidu_cookie)

    # 初始化百度用户信息
    if not baidu_pan.init_user_info():
        print("无法登录百度网盘，请检查 Cookie。")
        sys.exit(1)

    # 获取夸克文件详情
    files_info = quark_pan.get_file_info(fids)
    if not files_info:
        print("无法获取夸克文件下载链接，可能文件被封禁或 Cookie 失效。")
        sys.exit(1)

    success_count = 0
    for info in files_info:
        print(f"\n正在处理: {info['file_name']} ({info['size'] / 1024 / 1024:.2f} MB)")

        # 3.1 夸克: 取 slice md5
        slice_md5 = quark_pan.get_slice_md5(info['download_url'])
        if not slice_md5:
            print("  -> 获取 Slice MD5 失败，跳过。")
            continue

        # 3.2 百度: Precreate
        uploadid = baidu_pan.pre_create(info['file_name'], [info['md5']], info['size'])
        if not uploadid:
            print("  -> Precreate 失败，跳过。")
            continue

        # 3.3 计算 Offset 并下载分片
        now_ts = int(time.time())
        offset = BaiduPan.calculate_offset(baidu_pan.uk, info['md5'], now_ts, info['size'])
        chunk_b64 = quark_pan.download_chunk_base64(info['download_url'], offset, 262144)

        if not chunk_b64:
            print("  -> 下载校验分片失败，跳过。")
            continue

        # 3.4 百度: Rapid Upload
        if baidu_pan.rapid_upload(uploadid, info, slice_md5, chunk_b64, offset, now_ts):
            print("  -> 转存成功！")
            success_count += 1
        else:
            print("  -> 转存失败。")

    print(f"\n任务结束。成功: {success_count} / 总计: {len(files_info)}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n用户中断。")
    except Exception as e:
        logger.exception("发生未预期的错误")
