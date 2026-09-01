const { ApiError } = require("./errors");

function createWechatClient({ appId, appSecret, fetchImpl = fetch }) {
  return {
    async exchangeCode(code) {
      if (!appId || !appSecret) {
        throw new ApiError("服务器尚未配置微信 AppID 和 AppSecret", 500);
      }

      const endpoint = new URL("https://api.weixin.qq.com/sns/jscode2session");
      endpoint.search = new URLSearchParams({
        appid: appId,
        secret: appSecret,
        js_code: code,
        grant_type: "authorization_code",
      }).toString();

      const response = await fetchImpl(endpoint);
      if (!response.ok) throw new ApiError("微信登录服务暂时不可用", 500);

      const payload = await response.json();
      if (!payload.openid) {
        throw new ApiError(payload.errmsg || "微信登录凭证无效", 1600);
      }

      return { openid: payload.openid };
    },
  };
}

module.exports = { createWechatClient };
