const setting = require('./setting/setting.js');

App({
	onLaunch: function (options) {
		if (!setting.USE_SELF_HOSTED && wx.cloud) {
			wx.cloud.init({
				env: setting.CLOUD_ID,
				traceUser: true,
			})
		}

		this.globalData = {};

		// 用于自定义导航栏
		wx.getSystemInfo({
			success: e => {
					this.globalData.statusBarHeight = e.statusBarHeight;
				let capsule = wx.getMenuButtonBoundingClientRect();
				if (capsule) { 
					this.globalData.customBarHeight = capsule.bottom + capsule.top - e.statusBarHeight;
					this.globalData.capsule = capsule;
				} else {
					this.globalData.customBarHeight = e.statusBarHeight + 50;
				
				} 
			}
		});
	}, 
	 
})
