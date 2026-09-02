let localSetting = {};
try {
	localSetting = require('./setting.local.js');
} catch (err) {
	if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

module.exports = {
	// Keep deployment-specific values in the ignored setting.local.js file.
	USE_SELF_HOSTED: true,
	API_BASE_URL: '',
	CONTENT_CHECK_SERVICE_ID: '',

	//### 环境相关 
	CLOUD_ID: 'dev-5gf0o85o226fad1d', //云服务id ,本地测试环境 

	// #### 版本信息 
	VER: 'build 2022.08.14',
	COMPANY: '联系作者',

	// #### 系统参数 
	IS_SUB: false, //分包模式 
	IS_DEMO: false, //是否演示版  

	MOBILE_CHECK: false, //预约表单中的手机号只允许手动填写


	//#################     
	IMG_UPLOAD_SIZE: 20, //图片上传大小M兆    

	// #### 缓存相关
	CACHE_IS_LIST: true, //列表是否缓存
	CACHE_LIST_TIME: 60 * 30, //列表缓存时间秒    

	...localSetting,
}
