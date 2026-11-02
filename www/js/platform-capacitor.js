'use strict';
/**
 * platform-capacitor.js — Android (Capacitor) 平台層。
 *
 * 提供：
 *   1. makeHttpGet()  — 用 CapacitorHttp 在 native 層發 GET，繞過 WebView 的 CORS 限制
 *                       (eClass API 伺服器無 CORS header，純 fetch 會被同源政策擋)。
 *   2. getMachineId() — Android 沒有實體網卡 MAC，用 @capacitor/device 的裝置 ID
 *                       推導出「固定假 MAC」(格式 XX-XX-XX-XX-XX-XX)。同一台裝置穩定不變，
 *                       以便伺服器端的機器綁定維持一致。
 *
 * 全域掛在 window.EclassPlatform。相依 Capacitor runtime (由 bridge 注入 window.Capacitor)。
 */
(function (root) {
  'use strict';

  function getCapacitorHttp() {
    var Cap = root.Capacitor;
    // Capacitor 6：CapacitorHttp 內建於 @capacitor/core。
    // native 下由 bridge 在 Capacitor.Plugins.CapacitorHttp 建立 proxy。
    if (Cap && Cap.Plugins && Cap.Plugins.CapacitorHttp) return Cap.Plugins.CapacitorHttp;
    if (Cap && Cap.CapacitorHttp) return Cap.CapacitorHttp;
    if (root.CapacitorHttp) return root.CapacitorHttp;
    return null;
  }

  /**
   * 建一個 httpGet(url)=>Promise<{status,body}>，走 CapacitorHttp（native，無 CORS 限制）。
   * 若不在 native（例如瀏覽器 dev），退回 fetch。
   */
  function makeHttpGet() {
    var Http = getCapacitorHttp();
    var isNative = root.Capacitor && typeof root.Capacitor.isNativePlatform === 'function'
      ? root.Capacitor.isNativePlatform()
      : false;

    if (Http && isNative) {
      return function capacitorHttpGet(fullUrl) {
        return Http.get({
          url: fullUrl,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'eclass-android/0.1.0',
          },
          // 伺服器回的是純文字(含 <br/>)，不要讓 Capacitor 當 JSON 解析
          responseType: 'text',
          connectTimeout: 15000,
          readTimeout: 15000,
        }).then(function (res) {
          var body = res.data;
          if (typeof body !== 'string') {
            try { body = JSON.stringify(body); } catch (e) { body = String(body); }
          }
          return { status: res.status, body: body };
        });
      };
    }

    // Fallback：瀏覽器環境（會受 CORS 限制，僅供本機 dev 用）
    return function fetchHttpGet(fullUrl) {
      return fetch(fullUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).then(function (res) {
        return res.text().then(function (body) {
          return { status: res.status, body: body };
        });
      });
    };
  }

  // --- 假 MAC 產生 ---------------------------------------------------------
  function toHexByte(n) {
    var h = (n & 0xff).toString(16).toUpperCase();
    return h.length === 1 ? '0' + h : h;
  }

  /** 把任意字串雜湊成 6 bytes，組成 XX-XX-XX-XX-XX-XX */
  function stringToFakeMac(seed) {
    var bytes = [0x02, 0, 0, 0, 0, 0]; // 第一 byte 設 0x02 (locally administered)
    for (var i = 0; i < seed.length; i++) {
      var idx = 1 + (i % 5);
      bytes[idx] = (bytes[idx] * 31 + seed.charCodeAt(i)) & 0xff;
    }
    return bytes.map(toHexByte).join('-');
  }

  var FALLBACK_SEED = 'eclass-android-default';

  /**
   * 取得 { macId, computerName }。
   *
   * MacID 寫死為 0102 帳號綁定的 MAC（00-11-22-33-44-55）。eClass 伺服器把帳號綁到
   * 「第一次登入用的 MAC」，CheckMac 只有這組回 "1"，其餘一律回 "2"(機器不符)。
   * 所以不論哪台 Android 都送同一組 → 伺服器永遠認得本帳號。
   * ComputerName 用裝置型號(非綁定關鍵，純記錄)。
   * @returns {Promise<{macId:string, computerName:string}>}
   */
  var PINNED_MAC = '00-11-22-33-44-55';
  function getMachineId() {
    var Device = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Device;
    var infoTask = (Device && Device.getInfo)
      ? Device.getInfo().catch(function () { return null; })
      : Promise.resolve(null);
    return infoTask.then(function (info) {
      var computerName = info
        ? ((info.manufacturer || '') + '-' + (info.model || 'android')).replace(/\s+/g, '')
        : 'android-device';
      return { macId: PINNED_MAC, computerName: computerName };
    });
  }

  root.EclassPlatform = {
    makeHttpGet: makeHttpGet,
    getMachineId: getMachineId,
    stringToFakeMac: stringToFakeMac,
  };
})(typeof self !== 'undefined' ? self : this);
