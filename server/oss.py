"""阿里云 OSS 上传。

凭证只从环境变量读取，绝不写进代码、响应或日志：
- ACCESS_KEY_ID / ACCESS_KEY_SECRET（用户命名，优先）
- OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET（阿里云官方命名，兜底）
- OSS_ENDPOINT（如 https://oss-cn-hangzhou.aliyuncs.com）
- OSS_BUCKET（Bucket 名称）
- OSS_PUBLIC_URL_BASE（可选，公开访问前缀；缺省时按 endpoint 拼）
"""

import uuid

_KIND_SLUG = {
    "基准立绘": "base",
    "三视图": "turnaround",
    "表情差分图": "expression",
    "服饰拆解图": "clothing",
    "手部拆解图": "handsheet",
    "Q版形象": "chibi",
    "微调角色": "tune",
}


def _first(environ, *names):
    for name in names:
        value = (environ.get(name) or "").strip()
        if value:
            return value
    return ""


def oss_settings(environ):
    return {
        "access_key_id": _first(environ, "ACCESS_KEY_ID", "OSS_ACCESS_KEY_ID"),
        "access_key_secret": _first(environ, "ACCESS_KEY_SECRET", "OSS_ACCESS_KEY_SECRET"),
        "endpoint": (environ.get("OSS_ENDPOINT") or "").strip(),
        "bucket": (environ.get("OSS_BUCKET") or "").strip(),
        "public_base": (environ.get("OSS_PUBLIC_URL_BASE") or "").strip(),
    }


def oss_enabled(settings):
    return bool(
        settings["access_key_id"]
        and settings["access_key_secret"]
        and settings["endpoint"]
        and settings["bucket"]
    )


def new_object_key(kind=""):
    slug = _KIND_SLUG.get(kind, "image")
    return f"role-images/{slug}/{uuid.uuid4().hex}.png"


def public_url(settings, key):
    """构造可公开访问的对象 URL。优先用显式前缀，否则按 endpoint 拼 Bucket 域名。"""
    if settings["public_base"]:
        return f"{settings['public_base'].rstrip('/')}/{key}"
    host = settings["endpoint"].split("//", 1)[-1].rstrip("/")
    return f"https://{settings['bucket']}.{host}/{key}"


def upload_bytes(settings, key, data, content_type="image/png"):
    """用 oss2 SDK 简单上传字节流，返回公开 URL。"""
    import oss2  # 延迟导入，未安装 OSS SDK 时不影响其余功能。

    auth = oss2.Auth(settings["access_key_id"], settings["access_key_secret"])
    bucket = oss2.Bucket(auth, settings["endpoint"], settings["bucket"])
    bucket.put_object(key, data, headers={"Content-Type": content_type})
    return public_url(settings, key)


def _region_from_endpoint(endpoint):
    """从 endpoint 里提取区域：https://oss-cn-hangzhou.aliyuncs.com -> oss-cn-hangzhou。"""
    host = (endpoint or "").split("//", 1)[-1].split("/", 1)[0].strip()
    if not host:
        return ""
    # 兼容 oss-cn-hangzhou.aliyuncs.com / oss-cn-hangzhou-internal.aliyuncs.com / 自定义域名。
    return host.split(".", 1)[0] if host.startswith("oss-") else host


def _describe_oss_error(exc):
    """把 oss2 异常转成一句可读的、脱敏的原因。

    阿里云对「用错 endpoint 访问 bucket」会返回 403 AccessDenied，其 details 里
    带 Endpoint 字段指明正确区域——这里把它提取出来直接告诉用户改哪里。
    """
    details = getattr(exc, "details", None) or {}
    code = (details.get("Code") or "").strip()
    message = (details.get("Message") or str(exc)).strip()
    endpoint = (details.get("Endpoint") or "").strip()
    if endpoint:
        return f"{code}: {message}（建议将 OSS_ENDPOINT 改为 https://{endpoint}）"
    if code:
        return f"{code}: {message}"
    return str(exc)


def test_connection(settings, timeout=8, get_bucket=None):
    """探测 OSS 连通性：验证 endpoint / 凭证 / Bucket 三者是否匹配。

    返回 (ok, message)。ok 为 True 时 message 带 bucket 与所在区域；
    False 时带可读原因（含区域修正建议）。get_bucket 供测试注入。
    """
    if get_bucket is None:
        try:
            import oss2  # 延迟导入，未安装 OSS SDK 时给出明确提示。
        except ImportError:
            return False, "未安装 oss2 SDK（请 pip install oss2）"
        auth = oss2.Auth(settings["access_key_id"], settings["access_key_secret"])
        get_bucket = lambda: oss2.Bucket(
            auth, settings["endpoint"], settings["bucket"], connect_timeout=timeout,
        )
    try:
        bucket = get_bucket()
        info = bucket.get_bucket_info()
    except Exception as exc:
        return False, _describe_oss_error(exc)
    location = (getattr(info, "location", None) or "").strip()
    # get_bucket_info 在 endpoint 传错时往往仍能返回真实 location（不抛错），
    # 但随后 put_object 会 403。这里主动比对区域，不一致直接给出修正建议。
    endpoint_region = _region_from_endpoint(settings.get("endpoint") or "")
    if location and endpoint_region and endpoint_region != location:
        return False, (
            f"endpoint 区域 {endpoint_region} 与 bucket 实际区域 {location} 不一致"
            f"（建议将 OSS_ENDPOINT 改为 https://{location}.aliyuncs.com）"
        )
    suffix = f"（区域 {location}）" if location else ""
    return True, f"bucket={settings['bucket']}{suffix}"

