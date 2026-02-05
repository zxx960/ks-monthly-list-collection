<script setup lang="ts">
window.electronAPI.sendMessage('App loaded with webview layout!');

const handleButtonClick = () => {
  console.log('Button clicked!');
  window.electronAPI.sendMessage('Control button clicked!');
};
</script>

<template>
  <div class="container">
    <div class="webview-container">
      <webview 
        src="https://jigou.kuaishou.com/" 
        class="webview"
        allowpopups
        nodeintegration
        webpreferences="contextIsolation=false"
      ></webview>
    </div>
    <div class="control-panel">
      <h2>快手月榜单采集</h2>
      <button @click="handleButtonClick" class="control-button">
        采集数据
      </button>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  height: 100vh;
  width: 100vw;
  margin: 0;
  padding: 0;
}

.webview-container {
  width: 70%;
  height: 100%;
  border-right: 1px solid #ccc;
}

.webview {
  width: 100%;
  height: 100%;
  border: none;
}

.control-panel {
  width: 30%;
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background-color: #f5f5f5;
  padding-top: 20px;
}

.control-button {
  padding: 12px 24px;
  font-size: 16px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.control-button:hover {
  background-color: #0056b3;
}

h2 {
  margin-bottom: 30px;
  color: #333;
}
</style>
