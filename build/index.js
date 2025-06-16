/*
 * @Author: Damon Liu
 * @Date: 2025-04-27 13:53:33
 * @LastEditors: Damon Liu
 * @LastEditTime: 2025-06-12 17:51:13
 * @Description:
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import fetch from 'node-fetch';
import { createServer } from 'net';
import { exec } from 'child_process';
// 从命令行参数获取 --port 形式的端口号，默认为 3001
const portIndex = process.argv.indexOf('--port');
const port = portIndex !== -1 ? process.argv[portIndex + 1] || 3001 : 3001;
const addUrl = `http://localhost:${port}/api/schedules`;
const getUrl = `http://localhost:${port}/api/schedules/range`;
const deleteScheduleUrl = `http://localhost:${port}/api/schedules`;
const sockets = [];
let socketServer = null;
const killPort = () => {
    return new Promise((resolve) => {
        // Windows系统查找占用3001端口的进程ID
        exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
            if (err) {
                console.log('未找到占用端口的进程');
                resolve(null);
                return;
            }
            // 解析输出获取PID
            const lines = stdout.trim().split('\n');
            const pids = new Set();
            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                // netstat输出格式: [协议] [本地地址] [外部地址] [状态] [PID]
                // 只处理状态为LISTENING的进程
                if (parts.length >= 4 && parts[3] === 'LISTENING') {
                    const pid = parts[parts.length - 1];
                    if (!isNaN(Number(pid))) {
                        pids.add(pid);
                    }
                }
            });
            // 杀掉所有找到的进程
            if (pids.size > 0) {
                pids.forEach(pid => {
                    exec(`taskkill /F /PID ${pid}`, (killErr) => {
                        if (killErr) {
                            console.error(`终止进程 ${pid} 失败:`, killErr.message);
                        }
                        else {
                            console.log(`成功终止占用端口 ${port} 的进程 ${pid}`);
                        }
                    });
                });
                // 等待进程终止
                setTimeout(resolve, 1000);
            }
            else {
                resolve(null);
            }
        });
    });
};
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
server.server.onclose = () => {
    server.server.onclose = () => {
        // 修改关闭逻辑，添加回调和错误处理
        if (socketServer) {
            socketServer.close((err) => {
                if (err) {
                    console.error('socketServer关闭错误:', err);
                }
                else {
                    console.log('socketServer已关闭');
                    socketServer = null; // 重置socketServer引用
                }
            });
            // 关闭所有活跃连接
            sockets.forEach(socket => socket.destroy());
            sockets.length = 0;
        }
    };
};
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
        if (sockets.length) {
            const socket = sockets[0];
            const res = await new Promise((resolve, reject) => {
                socket['addScheduleResolve'] = resolve;
                socket.emit('add-schedule', { title: title, start: start, end: end, type: type, reminder: reminder, description: description, repeatType: repeatType, repeatInterval: repeatInterval, repeatDays: repeatDays, repeatEnd: repeatEnd });
            });
            return {
                content: [{
                        type: 'text',
                        text: res?.id ? '日程添加成功' : '日程添加失败'
                    }]
            };
        }
        else {
            return {
                content: [{
                        type: 'text',
                        text: '添加日程失败，暂无已连接客户端'
                    }]
            };
        }
        const response = await fetch(addUrl, {
            method: 'POST',
            body: JSON.stringify({ title: title, start: start, end: end, type: type, reminder: reminder, description: description, repeatType: repeatType, repeatInterval: repeatInterval, repeatDays: repeatDays, repeatEnd: repeatEnd }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const json = await response.json();
        return {
            content: [{
                    type: 'text',
                    text: json.id ? '日程添加成功' : '日程添加失败'
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
    const response = await fetch(`${getUrl}?start=${start}&end=${end}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    const json = await response.json();
    return {
        content: [{
                type: 'text',
                text: JSON.stringify(json)
            }]
    };
});
server.tool('delete-schedule', '删除日程', {
    id: z.string().describe('日程id')
}, async ({ id }) => {
    const response = await fetch(`${deleteScheduleUrl}/${id}`, {
        method: 'DELETE'
    });
    const json = await response.json();
    return {
        content: [{
                type: 'text',
                text: json.id ? '日程删除成功' : '日程删除失败'
            }]
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await killPort();
    if (server) {
        server.server.close();
    }
    if (socketServer) {
        // 修改socketServer启动逻辑，确保端口释放
        if (socketServer) {
            // 如果已有实例，先关闭
            await new Promise((resolve) => {
                socketServer.close((err) => {
                    if (err)
                        console.error('关闭现有socketServer错误:', err);
                    resolve(null);
                });
            });
        }
    }
    socketServer = createServer((socket) => {
        socket.id = `${(new Date())}-${Math.floor(Math.random() * 1e4)}`;
        socket['addScheduleResolve'] = null;
        sockets.push(socket);
        socket.on('data', (data) => {
            try {
                const dataJson = JSON.parse(data.toString());
                if (dataJson.type === 'add-schedule') {
                    socket?.addScheduleResolve?.(dataJson.data);
                }
            }
            catch (error) {
            }
        });
        socket.on('end', () => {
            sockets.splice(sockets.indexOf(socket), 1);
        });
    });
    socketServer?.listen(port, () => {
    });
    console.error("Schedule MCP Server running on stdio");
}
// 启动
main().catch((error) => {
    console.error("Fatal error in main():", error);
    socketServer?.close();
    socketServer = null;
    process.exit(1);
});
