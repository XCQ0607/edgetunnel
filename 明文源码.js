// Cloudflare Worker - 结合前端优选功能和后端代理转发
// 环境变量: UUID, KEY, DOMAIN

// ==================== 配置区域 ====================
// 在这里直接定义变量，如果环境变量存在则优先使用环境变量
// 使用示例:
// const DEFAULT_UUID = '12345678-1234-1234-1234-123456789abc';
// const DEFAULT_KEY = 'mykey123';
// const DEFAULT_DOMAIN = 'your-worker.your-subdomain.workers.dev';

const DEFAULT_UUID = '2982f122-9649-40dc-bc15-fa3ec91d8921';  // 在这里填入你的UUID
const DEFAULT_KEY = 'xcq0607';   // 在这里填入你的KEY（可选）
const DEFAULT_DOMAIN = ''; // 在这里填入你的域名
// ================================================

import { connect } from 'cloudflare:sockets';

// 全局变量
let userID = '';
let accessKey = '';
let domain = '';
let apiData = [];
let lastUpdateTime = '';


const expire = 4102329600; // 2099-12-31
let noTLS = 'false';
let path = '/?ed=2560';
let allowInsecure = '&allowInsecure=1';

export default {
    async fetch(request, env, ctx) {
        try {
            // 初始化环境变量，优先使用环境变量，否则使用默认值
            userID = env.UUID || DEFAULT_UUID;
            accessKey = env.KEY || DEFAULT_KEY;
            domain = env.DOMAIN || DEFAULT_DOMAIN;

            if (!userID) {
                return new Response('请设置UUID环境变量或在代码中定义DEFAULT_UUID', {
                    status: 404,
                    headers: { "Content-Type": "text/plain;charset=utf-8" }
                });
            }

            if (!domain) {
                return new Response('请设置DOMAIN环境变量或在代码中定义DEFAULT_DOMAIN', {
                    status: 404,
                    headers: { "Content-Type": "text/plain;charset=utf-8" }
                });
            }

            const url = new URL(request.url);
            const pathname = url.pathname.toLowerCase();

            // WebSocket升级处理（代理功能）
            const upgradeHeader = request.headers.get('Upgrade');
            if (upgradeHeader === 'websocket') {
                return await vlessOverWSHandler(request);
            }

            // 路由处理
            if (pathname === '/') {
                return handleHomePage();
            } else if (pathname === `/${userID}` || (accessKey && pathname === `/${accessKey}`)) {
                return await handleSubscription(request, url);
            } else if (pathname === `/${userID}/select` || (accessKey && pathname === `/${accessKey}/select`)) {
                return await handleSelectPage(request);
            } else if (pathname.match(/^\/[a-zA-Z]{2}\/[^\/]+$/)) {
                return await handleCountryAPI(request, url);
            } else if (pathname.match(/^\/bestip\/[^\/]+$/)) {
                return await handleBestIPAPI(request, url);
            } else if (pathname.match(/^\/([^\/]+)\/[^\/]+$/) && !pathname.includes('/select')) {
                return await handleRegionAPI(request, url);
            }

            return new Response('Not Found', { status: 404 });

        } catch (err) {
            return new Response(`Error: ${err.message}`, { status: 500 });
        }
    }
};

// 首页处理
function handleHomePage() {
    return new Response(`Hello, World \nAPI IP数量: ${apiData.length}\n最后更新时间: ${lastUpdateTime}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// 订阅处理
async function handleSubscription(request, url) {
    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');

    // 获取API数据
    if (apiData.length === 0) {
        apiData = await fetchApiData();
        lastUpdateTime = new Date().toLocaleString();
    }

    // 构建域名列表
    const domainList = [
        { domain: domain, name: `Vl-ws-tls-Worker` },
        { domain: "104.16.0.0", name: `Vl-ws-tls-CF1` },
        { domain: "104.17.0.0", name: `Vl-ws-tls-CF2` },
        { domain: "104.18.0.0", name: `Vl-ws-tls-CF3` },
        { domain: "cf.090227.xyz", name: "三网自适应分流官方优选" },
        { domain: "ct.090227.xyz", name: "电信官方优选" },
        { domain: "cmcc.090227.xyz", name: "移动官方优选" },
        { domain: "shopify.com", name: "优选官方域名-shopify" },
        { domain: "time.is", name: "优选官方域名-time" },
        { domain: "icook.hk", name: "优选官方域名-icook.hk" },
        { domain: "japan.com", name: "优选官方域名-japan" },
        { domain: "singapore.com", name: "优选官方域名-singapore" },
        { domain: "bestcf.onecf.eu.org", name: "Mingyu提供维护官方优选" },
        { domain: "cf.zhetengsha.eu.org", name: "小一提供维护官方优选" },
        ...apiData
    ];

    // 构建vless URL
    let vlessURL = domainList.map(item =>
        `vless://${userID}@${item.domain}:443?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=%2F#${item.name}`
    ).join('\n');

    if (isBase64) {
        vlessURL = btoa(vlessURL);
    }

    return new Response(vlessURL, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// 获取API数据
async function fetchApiData() {
    const apiList = [
        { url: 'https://ipdb.api.030101.xyz/?type=bestcf&country=true', namePrefix: '优选官方API(1-' },
        { url: 'https://addressesapi.090227.xyz/CloudFlareYes', namePrefix: '优选官方API(2-' },
        { url: 'https://addressesapi.090227.xyz/ip.164746.xyz', namePrefix: '优选官方API(3-' },
        { url: 'https://ipdb.api.030101.xyz/?type=bestproxy&country=true', namePrefix: '优选反代API(1-' }
    ];

    let allResults = [];

    for (const api of apiList) {
        try {
            const response = await fetch(api.url, { timeout: 8000 });
            if (response.ok) {
                const data = await response.text();
                const ipList = data.trim().split(/[\r\n]+/);

                ipList.forEach((item, index) => {
                    const ipParts = item.split('#');
                    const ip = ipParts[0].trim();
                    if (ip) {
                        let name = `${api.namePrefix}${index + 1})`;
                        if (ipParts.length > 1) {
                            name += `-${ipParts[1]}`;
                        }
                        allResults.push({ domain: ip, name: name });
                    }
                });
            }
        } catch (error) {
            console.error(`获取 ${api.url} 失败:`, error.message);
        }
    }

    return allResults;
}

// WebSocket处理函数（从original.js简化而来）
async function vlessOverWSHandler(request) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);

    webSocket.accept();

    let address = '';
    let portWithRandomLog = '';
    const log = (info, event) => {
        console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
    };
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWapper = { value: null };
    let udpStreamWrite = null;
    let isDns = false;

    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk, controller) {
            if (isDns) {
                return await handleDNSQuery(chunk, webSocket, null, log);
            }
            if (remoteSocketWapper.value) {
                const writer = remoteSocketWapper.value.writable.getWriter()
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            const {
                hasError,
                message,
                addressType,
                portRemote = 443,
                addressRemote = '',
                rawDataIndex,
                vlessVersion = new Uint8Array([0, 0]),
                isUDP,
            } = processVlessHeader(chunk, userID);

            address = addressRemote;
            portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '} `;

            if (hasError) {
                throw new Error(message);
                return;
            }

            if (isUDP) {
                if (portRemote === 53) {
                    isDns = true;
                } else {
                    throw new Error('UDP 代理仅对 DNS（53 端口）启用');
                    return;
                }
            }

            const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
            const rawClientData = chunk.slice(rawDataIndex);

            if (isDns) {
                return handleDNSQuery(rawClientData, webSocket, vlessResponseHeader, log);
            }

            handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log);
        },
        close() {
            log(`readableWebSocketStream is close`);
        },
        abort(reason) {
            log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
    })).catch((err) => {
        log('readableWebSocketStream pipeTo error', err);
    });

    return new Response(null, {
        status: 101,
        webSocket: client,
    });
}

// 处理国家API请求
async function handleCountryAPI(request, url) {
    const pathParts = url.pathname.split('/');
    const countryCode = pathParts[1].toUpperCase();
    const requestedUUID = pathParts[2];

    // 验证UUID或KEY
    if (requestedUUID !== userID && requestedUUID !== accessKey) {
        return new Response('Unauthorized', { status: 401 });
    }

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');

    try {
        const ipData = await fetchCountryBestIP(countryCode);
        if (ipData.length === 0) {
            return new Response(`未找到国家代码 ${countryCode} 的数据`, { status: 404 });
        }

        let vlessURL = ipData.map(item =>
            `vless://${userID}@${item.ip}:${item.port}?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=%2F#${countryCode}-${item.ip}-${item.port}`
        ).join('\n');

        if (isBase64) {
            vlessURL = btoa(vlessURL);
        }

        return new Response(vlessURL, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    } catch (error) {
        return new Response(`获取国家 ${countryCode} 的数据失败: ${error.message}`, { status: 500 });
    }
}

// 处理全球最佳IP请求
async function handleBestIPAPI(request, url) {
    const pathParts = url.pathname.split('/');
    const requestedUUID = pathParts[2];

    // 验证UUID或KEY
    if (requestedUUID !== userID && requestedUUID !== accessKey) {
        return new Response('Unauthorized', { status: 401 });
    }

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');

    try {
        const ipData = await fetchGlobalBestIP();
        if (ipData.length === 0) {
            return new Response('未找到全球最佳IP数据', { status: 404 });
        }

        let vlessURL = ipData.map(item => {
            const nodeName = `${item.ip}-${item.port}-${item.city || 'Unknown'}-${item.latency || 'Unknown'}`;
            return `vless://${userID}@${item.ip}:${item.port}?encryption=none&security=${item.tls ? 'tls' : 'none'}&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=%2F#${nodeName}`;
        }).join('\n');

        if (isBase64) {
            vlessURL = btoa(vlessURL);
        }

        return new Response(vlessURL, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    } catch (error) {
        return new Response(`获取全球最佳IP数据失败: ${error.message}`, { status: 500 });
    }
}

// 处理地区API请求
async function handleRegionAPI(request, url) {
    const pathParts = url.pathname.split('/');
    const region = pathParts[1];
    const requestedUUID = pathParts[2];

    // 验证UUID或KEY
    if (requestedUUID !== userID && requestedUUID !== accessKey) {
        return new Response('Unauthorized', { status: 401 });
    }

    const isBase64 = url.searchParams.has('base64') || url.searchParams.has('b64');
    const useRegex = url.searchParams.has('regex');

    try {
        const ipData = await fetchRegionBestIP(region, useRegex);
        if (ipData.length === 0) {
            return new Response(`未找到地区 ${region} 的数据`, { status: 404 });
        }

        let vlessURL = ipData.map(item => {
            const nodeName = `${region}-${item.city || 'Unknown'}-${item.latency || 'Unknown'}`;
            return `vless://${userID}@${item.ip}:${item.port}?encryption=none&security=${item.tls ? 'tls' : 'none'}&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=%2F#${nodeName}`;
        }).join('\n');

        if (isBase64) {
            vlessURL = btoa(vlessURL);
        }

        return new Response(vlessURL, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    } catch (error) {
        return new Response(`获取地区 ${region} 的数据失败: ${error.message}`, { status: 500 });
    }
}

// 获取特定国家最佳IP
async function fetchCountryBestIP(countryCode) {
    try {
        const url = `https://bestip.06151953.xyz/country/${countryCode}`;
        const response = await fetch(url, { timeout: 10000 });

        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
        return [];
    } catch (error) {
        console.error(`获取国家 ${countryCode} 的最佳IP数据失败:`, error.message);
        return [];
    }
}

// 获取全球最佳IP
async function fetchGlobalBestIP() {
    try {
        const url = 'https://bestip.06151953.xyz/bestip';
        const response = await fetch(url, { timeout: 10000 });

        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
        return [];
    } catch (error) {
        console.error('获取全球最佳IP数据失败:', error.message);
        return [];
    }
}

// 获取特定地区最佳IP
async function fetchRegionBestIP(region, useRegex) {
    try {
        let decodedRegion;
        try {
            decodedRegion = decodeURIComponent(region);
        } catch (e) {
            decodedRegion = region;
        }

        const encodedRegion = encodeURIComponent(decodedRegion);
        let url = `https://bestip.06151953.xyz/bestip/${encodedRegion}`;

        if (useRegex) {
            url += '?regex=true';
        }

        const response = await fetch(url, { timeout: 10000 });

        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
        return [];
    } catch (error) {
        console.error(`获取地区 ${region} 的最佳IP数据失败:`, error.message);
        return [];
    }
}

// 处理select页面
async function handleSelectPage(request) {
    try {
        const statsData = await fetchStatsData();

        // 城市到国家代码映射
        const cityToCountryCode = {
            'Frankfurt': 'DE', 'Stockholm': 'SE', 'Amsterdam': 'NL', 'Paris': 'FR',
            'Seoul': 'KR', 'Los Angeles': 'US', 'Warsaw': 'PL', 'London': 'GB',
            'San Jose': 'US', 'Helsinki': 'FI', 'Tokyo': 'JP', 'Singapore': 'SG',
            'Hong Kong': 'HK', 'Riga': 'LV', 'Fukuoka': 'JP', 'Ashburn': 'US',
            'Istanbul': 'TR', 'Toronto': 'CA', 'Madrid': 'ES', 'Portland': 'US',
            'Zurich': 'CH', 'Düsseldorf': 'DE', 'Seattle': 'US', 'Osaka': 'JP',
            'Bucharest': 'RO', 'Sofia': 'BG', 'Moscow': 'RU', 'Vienna': 'AT',
            'Chicago': 'US', 'Sydney': 'AU', 'Mumbai': 'IN', 'Milan': 'IT',
            'Newark': 'US', 'Buffalo': 'US', 'Tel Aviv': 'IL', 'Dallas': 'US',
            'Copenhagen': 'DK', 'Montréal': 'CA', 'São Paulo': 'BR', 'Taipei': 'TW'
        };

        const regions = statsData.byRegion ? Object.keys(statsData.byRegion) : [];
        const cities = statsData.byCity ? Object.keys(statsData.byCity) : [];

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vless代理URL构造工具</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        h1 { text-align: center; color: #333; }
        .section { margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .option-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        select, input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        select[multiple] { height: 150px; }
        .checkbox-label { font-weight: normal; display: flex; align-items: center; }
        .checkbox-label input { width: auto; margin-right: 8px; }
        button { background-color: #4CAF50; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; font-size: 16px; }
        button:hover { background-color: #45a049; }
        .result { margin-top: 20px; padding: 15px; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 5px; }
        .result-link { word-break: break-all; color: #0066cc; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .tabs { display: flex; margin-bottom: 15px; border-bottom: 1px solid #ddd; }
        .tab { padding: 10px 15px; cursor: pointer; background-color: #f1f1f1; border: 1px solid #ddd; border-bottom: none; margin-right: 5px; border-top-left-radius: 4px; border-top-right-radius: 4px; }
        .tab.active { background-color: #fff; border-bottom: 1px solid #fff; margin-bottom: -1px; }
        .stats-info { margin-bottom: 20px; font-size: 14px; color: #666; }
        .copy-btn { background-color: #2196F3; margin-left: 10px; }
        .copy-btn:hover { background-color: #0b7dda; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Vless代理URL构造工具</h1>

        <div class="stats-info">
            <p>当前共有 ${statsData.total || 0} 个IP地址</p>
            <p>平均延迟: ${statsData.averageLatency ? statsData.averageLatency.toFixed(2) + 'ms' : '未知'}</p>
            <p>最后更新时间: ${statsData.lastUpdate || '未知'}</p>
        </div>

        <div class="tabs">
            <div class="tab active" data-tab="multi-api">多API整合模式</div>
            <div class="tab" data-tab="country-api">国家API模式</div>
            <div class="tab" data-tab="region-api">地区API模式</div>
        </div>

        <div class="tab-content active" id="multi-api">
            <div class="section">
                <div class="option-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="multi-base64"> 使用Base64编码
                    </label>
                </div>
                <button onclick="generateMultiApiUrl()">生成URL</button>
                <div class="result" id="multi-api-result" style="display:none;">
                    <p>生成的URL:</p>
                    <a href="#" class="result-link" id="multi-api-link" target="_blank"></a>
                    <button class="copy-btn" onclick="copyToClipboard('multi-api-link')">复制</button>
                </div>
            </div>
        </div>

        <div class="tab-content" id="country-api">
            <div class="section">
                <div class="option-group">
                    <label for="country-select">选择国家:</label>
                    <select id="country-select" multiple>
                        ${cities.map(city => {
                            const code = cityToCountryCode[city] || '';
                            if (code) {
                                return `<option value="${code}">${city} (${code})</option>`;
                            }
                            return '';
                        }).filter(Boolean).join('')}
                    </select>
                </div>
                <div class="option-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="country-base64"> 使用Base64编码
                    </label>
                </div>
                <button onclick="generateCountryApiUrl()">生成URL</button>
                <div class="result" id="country-api-result" style="display:none;">
                    <p>生成的URL:</p>
                    <div id="country-api-links"></div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="region-api">
            <div class="section">
                <div class="option-group">
                    <label for="region-select">选择地区:</label>
                    <select id="region-select">
                        ${regions.map(region => `<option value="${region}">${region}</option>`).join('')}
                    </select>
                </div>
                <div class="option-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="region-base64"> 使用Base64编码
                    </label>
                </div>
                <div class="option-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="region-regex"> 启用正则搜索
                    </label>
                </div>
                <button onclick="generateRegionApiUrl()">生成URL</button>
                <div class="result" id="region-api-result" style="display:none;">
                    <p>生成的URL:</p>
                    <a href="#" class="result-link" id="region-api-link" target="_blank"></a>
                    <button class="copy-btn" onclick="copyToClipboard('region-api-link')">复制</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const UUID = '${userID}';
        const KEY = '${accessKey}';

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.getAttribute('data-tab');
                document.getElementById(tabId).classList.add('active');
            });
        });

        function generateMultiApiUrl() {
            const useBase64 = document.getElementById('multi-base64').checked;
            const accessId = KEY || UUID;
            let url = window.location.origin + '/' + accessId;
            if (useBase64) url += '?base64';

            const resultDiv = document.getElementById('multi-api-result');
            const linkElem = document.getElementById('multi-api-link');
            linkElem.href = url;
            linkElem.textContent = url;
            resultDiv.style.display = 'block';
        }

        function generateCountryApiUrl() {
            const select = document.getElementById('country-select');
            const selectedCountries = Array.from(select.selectedOptions).map(option => option.value);
            const useBase64 = document.getElementById('country-base64').checked;
            const accessId = KEY || UUID;

            if (selectedCountries.length === 0) {
                alert('请至少选择一个国家');
                return;
            }

            const linksDiv = document.getElementById('country-api-links');
            linksDiv.innerHTML = '';

            selectedCountries.forEach(country => {
                let url = window.location.origin + '/' + country + '/' + accessId;
                if (useBase64) url += '?base64';

                const linkContainer = document.createElement('div');
                linkContainer.style.marginBottom = '10px';

                const link = document.createElement('a');
                link.href = url;
                link.textContent = url;
                link.className = 'result-link';
                link.target = '_blank';

                const copyBtn = document.createElement('button');
                copyBtn.textContent = '复制';
                copyBtn.className = 'copy-btn';
                copyBtn.onclick = function() {
                    navigator.clipboard.writeText(url).then(() => alert('已复制到剪贴板'));
                };

                linkContainer.appendChild(link);
                linkContainer.appendChild(copyBtn);
                linksDiv.appendChild(linkContainer);
            });

            document.getElementById('country-api-result').style.display = 'block';
        }

        function generateRegionApiUrl() {
            const select = document.getElementById('region-select');
            const selectedRegion = select.value;
            const useBase64 = document.getElementById('region-base64').checked;
            const useRegex = document.getElementById('region-regex').checked;
            const accessId = KEY || UUID;

            if (!selectedRegion) {
                alert('请选择一个地区');
                return;
            }

            let url = window.location.origin + '/' + selectedRegion + '/' + accessId;
            const params = [];

            if (useBase64) params.push('base64');
            if (useRegex) params.push('regex=true');
            if (params.length > 0) url += '?' + params.join('&');

            const resultDiv = document.getElementById('region-api-result');
            const linkElem = document.getElementById('region-api-link');
            linkElem.href = url;
            linkElem.textContent = url;
            resultDiv.style.display = 'block';
        }

        function copyToClipboard(elementId) {
            const element = document.getElementById(elementId);
            navigator.clipboard.writeText(element.textContent).then(() => alert('已复制到剪贴板'));
        }
    </script>
</body>
</html>`;

        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    } catch (error) {
        return new Response('获取统计数据失败，无法生成URL构造界面', { status: 500 });
    }
}

// 获取统计数据
async function fetchStatsData() {
    try {
        const url = 'https://bestip.06151953.xyz/api/stats';
        const response = await fetch(url, { timeout: 10000 });

        if (response.ok) {
            return await response.json();
        }
        return {};
    } catch (error) {
        console.error('获取统计数据失败:', error.message);
        return {};
    }
}

// WebSocket相关核心函数（从original.js简化而来）
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
    let readableStreamCancel = false;
    const stream = new ReadableStream({
        start(controller) {
            webSocketServer.addEventListener('message', (event) => {
                if (readableStreamCancel) {
                    return;
                }
                const message = event.data;
                controller.enqueue(message);
            });

            webSocketServer.addEventListener('close', () => {
                safeCloseWebSocket(webSocketServer);
                if (readableStreamCancel) {
                    return;
                }
                controller.close();
            });

            webSocketServer.addEventListener('error', (err) => {
                log('webSocketServer has error');
                controller.error(err);
            });

            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) {
                controller.error(error);
            } else if (earlyData) {
                controller.enqueue(earlyData);
            }
        },

        pull(controller) {
            // 如果需要，可以在这里实现拉取逻辑
        },

        cancel(reason) {
            if (readableStreamCancel) {
                return;
            }
            log(`ReadableStream was canceled, due to ${reason}`);
            readableStreamCancel = true;
            safeCloseWebSocket(webSocketServer);
        }
    });

    return stream;
}

function processVlessHeader(vlessBuffer, userID) {
    if (vlessBuffer.byteLength < 24) {
        return {
            hasError: true,
            message: 'invalid data',
        };
    }
    const version = new Uint8Array(vlessBuffer.slice(0, 1));
    let isValidUser = false;
    let isUDP = false;
    const slicedBuffer = new Uint8Array(vlessBuffer.slice(1, 17));
    const slicedBufferString = stringify(slicedBuffer);

    const uuids = userID.includes(',') ? userID.split(',') : [userID];
    const checkUuid = uuids.some(uuid => slicedBufferString === uuid.trim());

    isValidUser = checkUuid;
    if (!isValidUser) {
        return {
            hasError: true,
            message: 'invalid user',
        };
    }

    const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
    const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];

    if (command === 1) {
        // TCP
    } else if (command === 2) {
        // UDP
        isUDP = true;
    } else {
        return {
            hasError: true,
            message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`,
        };
    }
    const portIndex = 18 + optLength + 1;
    const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
    const portRemote = new DataView(portBuffer).getUint16(0);

    let addressIndex = portIndex + 2;
    const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));

    const addressType = addressBuffer[0];
    let addressLength = 0;
    let addressValueIndex = addressIndex + 1;
    let addressValue = '';
    switch (addressType) {
        case 1:
            addressLength = 4;
            addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
            break;
        case 2:
            addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 3:
            addressLength = 16;
            const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(':');
            break;
        default:
            return {
                hasError: true,
                message: `invild  addressType is ${addressType}`,
            };
    }
    if (!addressValue) {
        return {
            hasError: true,
            message: `addressValue is empty, addressType is ${addressType}`,
        };
    }

    return {
        hasError: false,
        addressRemote: addressValue,
        addressType,
        portRemote,
        rawDataIndex: addressValueIndex + addressLength,
        vlessVersion: version,
        isUDP,
    };
}

function stringify(arr) {
    return arr.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
}

function base64ToArrayBuffer(base64Str) {
    if (!base64Str) {
        return { error: null };
    }
    try {
        base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
        const decode = atob(base64Str);
        const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arryBuffer.buffer, error: null };
    } catch (error) {
        return { error };
    }
}

function safeCloseWebSocket(socket) {
    try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close();
        }
    } catch (error) {
        console.error('safeCloseWebSocket error', error);
    }
}

// TCP出站连接处理
async function handleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log) {
    async function connectAndWrite(address, port) {
        const tcpSocket = connect({
            hostname: address,
            port: port,
        });
        remoteSocketWapper.value = tcpSocket;
        log(`connected to ${address}:${port}`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        return tcpSocket;
    }

    async function retry() {
        const tcpSocket = await connectAndWrite(addressRemote, portRemote);
        tcpSocket.closed.catch(error => {
            console.log('retry tcpSocket closed error', error);
        }).finally(() => {
            safeCloseWebSocket(webSocket);
        });
        remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, null, log);
    }

    const tcpSocket = await connectAndWrite(addressRemote, portRemote);

    remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log);
}

// 远程Socket到WebSocket的数据传输
async function remoteSocketToWS(remoteSocket, webSocket, vlessResponseHeader, retry, log) {
    let remoteChunkCount = 0;
    let chunks = [];
    let vlessHeader = vlessResponseHeader;
    let hasIncomingData = false;

    await remoteSocket.readable
        .pipeTo(
            new WritableStream({
                start() {
                    // 开始处理
                },
                async write(chunk, controller) {
                    hasIncomingData = true;
                    remoteChunkCount++;
                    if (webSocket.readyState !== WebSocket.OPEN) {
                        controller.error('webSocket.readyState is not open, maybe close');
                    }
                    if (vlessHeader) {
                        webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
                        vlessHeader = null;
                    } else {
                        webSocket.send(chunk);
                    }
                },
                close() {
                    log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
                },
                abort(reason) {
                    console.error(`remoteConnection!.readable abort`, reason);
                },
            })
        )
        .catch((error) => {
            console.error(`remoteSocketToWS has exception `, error.stack || error);
            safeCloseWebSocket(webSocket);
        });

    if (hasIncomingData === false && retry) {
        log(`retry`);
        retry();
    }
}

// DNS查询处理
async function handleDNSQuery(udpChunk, webSocket, vlessResponseHeader, log) {
    try {
        const dnsServer = '8.8.4.4';
        const dnsPort = 53;

        let vlessHeader = vlessResponseHeader;

        const tcpSocket = connect({
            hostname: dnsServer,
            port: dnsPort,
        });

        log(`connected to ${dnsServer}:${dnsPort}`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(udpChunk);
        writer.releaseLock();

        await tcpSocket.readable
            .pipeTo(
                new WritableStream({
                    async write(chunk) {
                        if (webSocket.readyState === WebSocket.OPEN) {
                            if (vlessHeader) {
                                webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
                                vlessHeader = null;
                            } else {
                                webSocket.send(chunk);
                            }
                        }
                    },
                    close() {
                        log(`DNS query completed`);
                    },
                    abort(reason) {
                        console.error('DNS query aborted', reason);
                    },
                })
            )
            .catch((error) => {
                console.error('DNS query error:', error);
            });

    } catch (error) {
        console.error('handleDNSQuery error:', error);
    }
}
