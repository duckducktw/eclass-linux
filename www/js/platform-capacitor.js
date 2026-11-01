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
   * 用 @capacitor/device 的 identifier 當 seed 推固定假 MAC；取不到就用 fallback seed。
   * @returns {Promise<{macId:string, computerName:string}>}
   */
  function getMachineId() {
    var Device = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Device;
    var tasks = [];
    if (Device && Device.getId) {
      tasks.push(
        Device.getId().then(function (r) {
          // Capacitor 6: { identifier }；舊版: { uuid }
          return r && (r.identifier || r.uuid);
        }).catch(function () { return null; })
      );
    } else {
      tasks.push(Promise.resolve(null));
    }
    if (Device && Device.getInfo) {
      tasks.push(Device.getInfo().catch(function () { return null; }));
    } else {
      tasks.push(Promise.resolve(null));
    }

    return Promise.all(tasks).then(function (res) {
      var id = res[0];
      var info = res[1];
      var seed = id || (info && (info.model || '') + (info.manufacturer || '')) || FALLBACK_SEED;
      var macId = stringToFakeMac(String(seed));
      var computerName = info
        ? ((info.manufacturer || '') + '-' + (info.model || 'android')).replace(/\s+/g, '')
        : 'android-device';
      return { macId: macId, computerName: computerName };
    });
  }

  root.EclassPlatform = {
    makeHttpGet: makeHttpGet,
    getMachineId: getMachineId,
    stringToFakeMac: stringToFakeMac,
  };
})(typeof self !== 'undefined' ? self : this);
