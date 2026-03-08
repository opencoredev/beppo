(function () {
  if (typeof window === "undefined" || window.desktopBridge) {
    return;
  }

  var nextRequestId = 0;
  var pending = new Map();
  var menuActionListeners = new Set();
  var updateStateListeners = new Set();
  var currentUrl = new URL(window.location.href);
  var wsUrl =
    currentUrl.searchParams.get("beppoDesktopWsUrl") ||
    currentUrl.searchParams.get("t3DesktopWsUrl");

  function postMessage(payload) {
    if (!window.__electrobunBunBridge || typeof window.__electrobunBunBridge.postMessage !== "function") {
      throw new Error("Desktop bridge is unavailable.");
    }
    window.__electrobunBunBridge.postMessage(JSON.stringify(payload), self.location.origin);
  }

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = "desktop_" + String(++nextRequestId);
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        postMessage({ kind: "request", id: id, method: method, params: params });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function handleBridgeMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.kind === "response" && typeof message.id === "string") {
      var pendingRequest = pending.get(message.id);
      if (!pendingRequest) {
        return;
      }
      pending.delete(message.id);
      if (message.ok === true) {
        pendingRequest.resolve(message.result);
        return;
      }
      pendingRequest.reject(new Error(typeof message.error === "string" ? message.error : "Desktop bridge request failed."));
      return;
    }

    if (message.kind === "event" && typeof message.event === "string") {
      if (message.event === "menu-action") {
        menuActionListeners.forEach(function (listener) {
          listener(message.payload);
        });
        return;
      }
      if (message.event === "update-state") {
        updateStateListeners.forEach(function (listener) {
          listener(message.payload);
        });
      }
    }
  }

  if (!window.__electrobun) {
    window.__electrobun = {
      receiveInternalMessageFromBun: function () {},
      receiveMessageFromBun: handleBridgeMessage,
    };
  } else {
    window.__electrobun.receiveMessageFromBun = handleBridgeMessage;
  }

  window.desktopBridge = {
    getWsUrl: function () {
      return wsUrl;
    },
    pickFolder: function () {
      return request("pickFolder");
    },
    confirm: function (message) {
      return request("confirm", message);
    },
    showContextMenu: function (items, position) {
      return request("showContextMenu", { items: items, position: position });
    },
    openExternal: function (url) {
      return request("openExternal", url);
    },
    onMenuAction: function (listener) {
      menuActionListeners.add(listener);
      return function () {
        menuActionListeners.delete(listener);
      };
    },
    getUpdateState: function () {
      return request("getUpdateState");
    },
    downloadUpdate: function () {
      return request("downloadUpdate");
    },
    installUpdate: function () {
      return request("installUpdate");
    },
    onUpdateState: function (listener) {
      updateStateListeners.add(listener);
      return function () {
        updateStateListeners.delete(listener);
      };
    },
  };
})();
