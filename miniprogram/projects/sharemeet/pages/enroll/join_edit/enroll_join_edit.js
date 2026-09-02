const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const dataHelper = require('../../../../../helper/data_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const projectSetting = require('../../../public/project_setting.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

Page({
	/**
	 * 页面的初始数据
	 */
	data: {
		isLoad: false,
		isLogin: true,

		isEdit: true,
		isLoadTime: false,

		day: '',
		start: '',
		end: '',
		endPoint: '',
		initialStart: '',
		initialEnd: '',
		initialEndPoint: '',
		used: [],
		forms: [],
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		if (!pageHelper.getOptions(this, options)) return;
		if (!pageHelper.getOptions(this, options, 'enrollJoinId')) return;

		if (!await PassportBiz.loginMustBackWin(this)) return;

		this._loadDetail();

	},

	_loadDetail: async function () {
		let id = this.data.id;
		if (!id) return;


		let params = {
			enrollId: id,
			enrollJoinId: this.data.enrollJoinId
		};
		let opt = {
			title: 'bar'
		};
		let enroll = await cloudHelper.callCloudData('enroll/detail_for_join', params, opt);
		if (!enroll) {
			this.setData({
				isLoad: null
			})
			return;
		}

		if (!Array.isArray(enroll.ENROLL_JOIN_FORMS) || enroll.ENROLL_JOIN_FORMS.length == 0)
			enroll.ENROLL_JOIN_FORMS = projectSetting.ENROLL_JOIN_FIELDS;
		if (!enroll.join) {
			this.setData({ isLoad: null });
			return;
		}

		this.setData({
			isLoad: true,
			enroll,
			day: enroll.join.day,
			start: enroll.join.start,
			end: enroll.join.end,
			endPoint: enroll.join.endPoint,
			initialStart: enroll.join.start,
			initialEnd: enroll.join.end,
			initialEndPoint: enroll.join.endPoint,
		});
		this._loadDayData(enroll.join.day);

	},

	_loadDayData: async function (day) {
		if (!day) return;
		this.setData({ isLoadTime: false });
		let params = {
			enrollId: this.data.id,
			enrollJoinId: this.data.enrollJoinId,
			day,
		};
		let opts = { title: 'bar' };
		try {
			let result = await cloudHelper.callCloudSumbit('enroll/day', params, opts);
			this.setData({ isLoadTime: true, used: result.data });
		} catch (err) {
			console.error(err);
		}

	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () { },

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () {

	},

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () {

	},

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () {

	},

	/**
	 * 页面相关事件处理函数--监听用户下拉动作
	 */
	onPullDownRefresh: async function () {
		this.setData({
			isLoad: false
		}, async () => {
			await this._loadDetail();
		});
		wx.stopPullDownRefresh();
	},



	url: function (e) {
		pageHelper.url(e, this);
	},

	onPageScroll: function (e) {
		// 回页首按钮
		pageHelper.showTopBtn(e, this);

	},

	bindCheckTap: async function (e) {
		if (!this.data.day || !this.data.start || !this.data.end || !this.data.endPoint)
			return pageHelper.showModal('请选择预约时段');
		this.selectComponent("#form-show").checkForms();
	},

	bindDateSelectCmpt: function (e) {
		let day = e.detail;
		this.setData({
			day,
			start: '',
			end: '',
			endPoint: '',
			initialStart: '',
			initialEnd: '',
			initialEndPoint: '',
		}, () => {
			this._loadDayData(day);
		});
	},

	bindTimeSelectCmpt: function (e) {
		this.setData({
			start: e.detail.start,
			end: e.detail.end,
			endPoint: e.detail.endPoint,
		});
	},

	bindSubmitCmpt: async function (e) {
		let forms = e.detail;

		let enrollJoinId = this.data.enrollJoinId;

		try {
			let opts = {
				title: '提交中'
			}
			let params = {
				enrollId: this.data.id,
				enrollJoinId,
				day: this.data.day,
				start: this.data.start,
				end: this.data.end,
				endPoint: this.data.endPoint,
				forms
			}
			await cloudHelper.callCloudSumbit('enroll/join_edit', params, opts).then(res => { 
				let callback = () => {
					// 更新列表页面数据
					let nameForm = dataHelper.getDataByKey(forms, 'mark', 'name');
					let node = {
						'ENROLL_JOIN_OBJ': {
							'name': nameForm ? nameForm.val : '',
						},
						'ENROLL_JOIN_DAY_DESC': this.data.day.replace(/-/g, '.'),
						'ENROLL_JOIN_START': this.data.start,
						'ENROLL_JOIN_END': this.data.end,
						'ENROLL_JOIN_END_POINT': this.data.endPoint,
					}
					pageHelper.modifyPrevPageListNodeObject(enrollJoinId, node);

					wx.navigateBack();

				}
				pageHelper.showSuccToast('修改成功', 2000, callback);


			})
		} catch (err) {
			console.log(err);
		};
	}

})
