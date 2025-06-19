/*
 * @Author: Damon Liu
 * @Date: 2025-04-27 13:53:33
 * @LastEditors: Damon Liu
 * @LastEditTime: 2025-06-19 10:59:52
 * @Description:
 */
// 适配低版本的node写法
if (!Promise.withResolvers) {
    Promise.withResolvers = function () {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };
}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
// 以下是libp2p的库
import { mdns } from '@libp2p/mdns';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { yamux } from '@chainsafe/libp2p-yamux';
import { noise } from '@chainsafe/libp2p-noise';
import { kadDHT } from '@libp2p/kad-dht';
import { ping } from '@libp2p/ping';
import { identify } from '@libp2p/identify';
import { pipe } from 'it-pipe';
//import { streamToConsole } from './stream.js';
import * as lp from 'it-length-prefixed';
import map from 'it-map';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { peerIdFromPublicKey } from '@libp2p/peer-id';
dotenv.config();
// Create server instance
// 创建一个服务端实例
const server = new McpServer({
    name: "schedule-electron",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
// 新增日程回调
let addScheduleResolve = null;
// 查询日程回调
let checkScheduleResolve = null;
// 删除日程回调
let deleteScheduleResolve = null;
const chatProtocol = '/mcpSchedules/1.0.0';
async function createNode(port) {
    const node = await createLibp2p({
        addresses: {
            listen: [`/ip4/127.0.0.1/tcp/${port}`]
        },
        transports: [tcp()],
        streamMuxers: [yamux()], // 添加流多路复用器
        connectionEncrypters: [noise()],
        peerDiscovery: [
            mdns({
                interval: 2000, // 每2秒发送一次发现广播
                serviceTag: 'mcp-shedules-local-libp2p-network' // 自定义服务标识，避免与其他mDNS服务冲突
            })
        ],
        services: {
            // 添加ping服务依赖
            ping: ping(),
            identify: identify(), // Add 
            dht: kadDHT({
                clientMode: true
            }),
        } // 
    });
    // 监听节点启动事件
    node.addEventListener('start', () => {
        //console.log(`节点已启动，ID: ${node.peerId.toString()}`)
        const addresses = node.getMultiaddrs().map(addr => addr.toString());
        //console.log('监听地址:')
        //addresses.forEach(addr => console.log(addr))
    });
    // 监听消息事件
    node.handle(chatProtocol, async ({ stream }) => {
        //streamToConsole(stream as any);
        pipe(
        // Read from the stream (the source)
        stream.source, 
        // Decode length-prefixed data
        (source) => lp.decode(source), 
        // Turn buffers into strings
        (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())), 
        // Sink function
        async function (source) {
            // Wait for all data to be received
            // For each chunk of data
            for await (const msg of source) {
                // Output the data as a utf8 string
                //console.log('> ' + msg.toString().replace('\n', ''))
                try {
                    // 序列化节点消息
                    const res = JSON.parse(msg.toString().replace('\n', ''));
                    // 处理新增消息回调
                    if (res.type === 'add-schedule-resolve') {
                        if (addScheduleResolve) {
                            addScheduleResolve(res.data);
                            addScheduleResolve = null;
                        }
                    }
                    // 处理查询消息回调
                    else if (res.type === 'check-schedule-resolve') {
                        if (checkScheduleResolve) {
                            checkScheduleResolve(res.data);
                            checkScheduleResolve = null;
                        }
                    }
                    // 处理删除消息回调
                    else if (res.type === 'delete-schedule-resolve') {
                        if (deleteScheduleResolve) {
                            deleteScheduleResolve(res.data);
                            deleteScheduleResolve = null;
                        }
                    }
                    // 处理清空消息回调
                    else if(res.type === 'clear-all-schedules-resolve') {
                        if (clearAllSchedulesResolve) {
                            clearAllSchedulesResolve(res.data);
                            clearAllSchedulesResolve = null;
                        }
                    }
                }
                catch (error) {
                    
                }
            }
        });
    });
    // 监听节点发现事件
    // 由于类型不兼容问题，可能需要使用更宽泛的类型或者检查导入的类型是否一致
    // 这里尝试使用更宽泛的 CustomEvent 类型，暂时不指定具体泛型参数
    node.addEventListener('peer:discovery', (event) => {
        const peerInfo = event.detail;
        //console.log(`🔍 发现新节点: ${peerInfo.id.toString()}`)
        const multiaddr = peerInfo.multiaddrs.find((addr) => addr.toString().includes('tcp'));
        // 自动连接发现的节点
        node.dialProtocol(multiaddr, chatProtocol).then((stream) => {
            // console.log(`✅ 已自动连接到节点: ${peerInfo.id.toString()}`)
        }).catch(err => {
            //console.error(`❌ 连接节点失败: ${err.message}`)
        });
    });
    node.addEventListener('peer:disconnect', (evt) => {
        //console.log(evt)
        const peerId = peerIdFromPublicKey(evt?.detail?.publicKey)?.toString();
        //console.log(`❌ 节点断开连接: ${peerId}`)
    });
    await node.start();
    return node;
}
server.tool('add-schedule', '添加日程或提醒，如果用户没有指定结束时间: end，则默认结束时间为开始时间: start或提醒时间: reminder加一小时', {
    title: z.string().describe('日程标题'),
    start: z.string().describe('开始时间，格式： YYYY-MM-DD HH:mm:ss'),
    end: z.string().describe('结束时间，格式： YYYY-MM-DD HH:mm:ss。 用户没指定的时候默认值为开始时间加一小时'),
    type: z.string().describe('日程类型，格式为：important: 重要, 日常:normal, 次要:minor, 用户不提及的时候默认为日常'),
    reminder: z.string().describe('提醒时间，格式： YYYY-MM-DD HH:mm:ss'),
    description: z.string().describe('日程描述'),
    repeatType: z.string().describe('重复类型，格式为：daily: 每天, weekly: 每周, monthly: 每月, yearly: 每年 , none: 不重复'),
    repeatInterval: z.number().describe('重复间隔，格式为：1, 2, 3, 4, 5, 6, 7, 8, 9, 10'),
    repeatDays: z.array(z.number()).describe('重复天数，格式为：[1, 2, 3, 4, 5, 6, 7], 当repeatType为weekly时，该字段代表周的哪几天，从1开始，0代表周日。 当repeatType为monthly时，该字段代表月的哪几天，从1开始，0代表最后一天。 当repeatType为yearly时，该字段代表年的哪几天，从1开始，0代表最后一天。'),
    repeatEnd: z.string().describe('重复结束时间，格式： YYYY-MM-DD HH:mm:ss')
}, async ({ title, start, end, type, reminder, description, repeatType, repeatInterval, repeatDays, repeatEnd }) => {
    try {
        const res = await new Promise((resolve, reject) => {
            addScheduleResolve = resolve;
            const body = { title: title, start: start, end: end, type: type, reminder: reminder, description: description, repeatType: repeatType, repeatInterval: repeatInterval, repeatDays: repeatDays, repeatEnd: repeatEnd };
            if (node?.getPeers().length === 0) {
                addScheduleResolve = null;
                resolve({
                    message: '添加日程失败，没有链接节点'
                });
            }
            node?.getPeers().forEach(async (peerId) => {
                const addr = (await node?.peerStore.getInfo(peerId))?.multiaddrs?.find((addr) => addr.toString().includes('tcp'));
                if (!addr) {
                    return;
                }
                const stream = await node?.dialProtocol(addr, chatProtocol);
                if (stream) {
                    const json = {
                        type: 'add-schedule',
                        fromPeer: node?.peerId.toString(),
                        data: body
                    };
                    pipe([JSON.stringify(json)], 
                    // Turn strings into buffers
                    (source) => map(source, (string) => uint8ArrayFromString(string)), 
                    // Encode with length prefix (so receiving side knows how much data is coming)
                    (source) => lp.encode(source), 
                    // Write to the stream (the sink)
                    stream.sink);
                }
            });
        });
        return {
            content: [{
                    type: 'text',
                    text: res?.id ? '日程添加成功' : '日程添加失败'
                }]
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: '日程添加失败：' + error.message
                }]
        };
    }
});
server.tool('get-current-date', '获取当前日期，进行日程操作时先执行这个更新日期', {}, async () => {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const hours = String(currentDate.getHours()).padStart(2, '0');
    const minutes = String(currentDate.getMinutes()).padStart(2, '0');
    const seconds = String(currentDate.getSeconds()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return {
        content: [{
                type: 'text',
                text: formattedDate
            }]
    };
});
server.tool('get-schedules', '获取日程', {
    start: z.string().describe('开始时间，格式： YYYY-MM-DD HH:mm:ss'),
    end: z.string().describe('结束时间，格式： YYYY-MM-DD HH:mm:ss')
}, async ({ start, end }) => {
    const res = await new Promise((resolve, reject) => {
        checkScheduleResolve = resolve;
        if (node?.getPeers().length === 0) {
            checkScheduleResolve = null;
            resolve({
                message: '获取日程失败，没有链接节点'
            });
        }
        node?.getPeers().forEach(async (peerId) => {
            const addr = (await node?.peerStore.getInfo(peerId))?.multiaddrs?.find((addr) => addr.toString().includes('tcp'));
            if (!addr) {
                return;
            }
            const stream = await node?.dialProtocol(addr, chatProtocol);
            if (stream) {
                const json = {
                    type: 'get-schedules',
                    fromPeer: node?.peerId.toString(),
                    data: { start: start, end: end }
                };
                pipe([JSON.stringify(json)], 
                // Turn strings into buffers
                (source) => map(source, (string) => uint8ArrayFromString(string)), 
                // Encode with length prefix (so receiving side knows how much data is coming)
                (source) => lp.encode(source), 
                // Write to the stream (the sink)
                stream.sink);
            }
        });
    });
    return {
        content: [{
                type: 'text',
                text: JSON.stringify(res)
            }]
    };
});
server.tool('delete-schedule', '删除日程', {
    id: z.string().describe('日程id')
}, async ({ id }) => {
    const res = await new Promise((resolve, reject) => {
        deleteScheduleResolve = resolve;
        if (node?.getPeers().length === 0) {
            deleteScheduleResolve = null;
            resolve({
                message: '添加日程失败，没有链接节点'
            });
        }
        node?.getPeers().forEach(async (peerId) => {
            const addr = (await node?.peerStore.getInfo(peerId))?.multiaddrs?.find((addr) => addr.toString().includes('tcp'));
            if (!addr) {
                return;
            }
            const stream = await node?.dialProtocol(addr, chatProtocol);
            //const stream = peerIdToStreamMap[peerId.toString()];
            if (stream) {
                const json = {
                    type: 'delete-schedule',
                    fromPeer: node?.peerId.toString(),
                    data: { id: id }
                };
                pipe([JSON.stringify(json)], 
                // Turn strings into buffers
                (source) => map(source, (string) => uint8ArrayFromString(string)), 
                // Encode with length prefix (so receiving side knows how much data is coming)
                (source) => lp.encode(source), 
                // Write to the stream (the sink)
                stream.sink);
            }
        });
    });
    return {
        content: [{
                type: 'text',
                text: res.id ? '日程删除成功' : '日程删除失败'
            }]
    };
});
// p2pnode
let node = null;
async function main() {
    const transport = new StdioServerTransport();
    if (!node) {
        node = await createNode(0);
    }
    await server.connect(transport);
    // 处理 exit
    process.on('exit', async () => {
        await node?.stop();
        node = null;
        process.exit(0);
    });
    console.error("Schedule MCP Server running on stdio");
}
// 启动
main().catch((error) => {
    console.error("Fatal error in main():", error);
    node?.stop();
    node = null;
    process.exit(1);
});
