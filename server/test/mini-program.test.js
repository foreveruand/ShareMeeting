const assert = require("node:assert/strict");
const test = require("node:test");

const cacheHelper = require("../../miniprogram/helper/cache_helper");
const cloudHelper = require("../../miniprogram/helper/cloud_helper");
const PassportBiz = require("../../miniprogram/comm/biz/passport_biz");

function createWx(login) {
  const storage = new Map();
  return {
    clearStorageSync: () => storage.clear(),
    getStorageSync: (key) => storage.get(key),
    login,
    removeStorageSync: (key) => storage.delete(key),
    setStorageSync: (key, value) => storage.set(key, value),
  };
}

test("silent login shares one WeChat exchange for concurrent callers", { concurrency: false }, async () => {
  const originalLoginWithWechatCode = cloudHelper.loginWithWechatCode;
  let wxLoginCalls = 0;
  global.wx = createWx(({ success }) => {
    wxLoginCalls += 1;
    setTimeout(() => success({ code: "shared-code" }), 0);
  });
  cacheHelper.clear();
  PassportBiz.loginPromise = null;
  cloudHelper.loginWithWechatCode = async (code) => {
    assert.equal(code, "shared-code");
    return { data: { token: { id: "user-1", name: "Alice", status: 1, accessToken: "token-1" } } };
  };

  try {
    const firstPage = { setData() {} };
    const secondPage = { setData() {} };
    const result = await Promise.all([
      PassportBiz.loginSilence(firstPage),
      PassportBiz.loginSilence(secondPage),
    ]);

    assert.deepEqual(result, [true, true]);
    assert.equal(wxLoginCalls, 1);
    assert.equal(PassportBiz.getToken().accessToken, "token-1");
  } finally {
    cloudHelper.loginWithWechatCode = originalLoginWithWechatCode;
    PassportBiz.loginPromise = null;
  }
});

test("personal page coalesces concurrent profile loads", { concurrency: false }, async () => {
  const originalCallCloudSubmit = cloudHelper.callCloudSumbit;
  const originalLoginSilence = PassportBiz.loginSilence;
  const pagePath = require.resolve("../../miniprogram/projects/sharemeet/pages/my/index/my_index");
  const originalPage = global.Page;
  let definition;
  let profileCalls = 0;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[pagePath];
  require(pagePath);

  cloudHelper.callCloudSumbit = async (route) => {
    assert.equal(route, "passport/my_detail");
    profileCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { data: { USER_NAME: "Alice" } };
  };
  PassportBiz.loginSilence = async () => true;

  try {
    const page = {
      ...definition,
      data: { ...definition.data },
      setData(update) {
        Object.assign(this.data, update);
      },
    };
    await Promise.all([page.onShow(), page.onShow()]);

    assert.equal(profileCalls, 1);
    assert.deepEqual(page.data.user, { USER_NAME: "Alice" });
  } finally {
    cloudHelper.callCloudSumbit = originalCallCloudSubmit;
    PassportBiz.loginSilence = originalLoginSilence;
    global.Page = originalPage;
    delete require.cache[pagePath];
  }
});
