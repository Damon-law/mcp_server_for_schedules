/*
 * @Author: Damon Liu
 * @Date: 2025-04-27 16:57:08
 * @LastEditors: Damon Liu
 * @LastEditTime: 2025-04-30 16:38:39
 * @Description: 
 */
import fetch from 'node-fetch';

const addUrl = 'http://localhost:3001/api/schedules';

const addSchedule = async () => {
    const response = await fetch(addUrl, {
        method: 'POST',
        body: JSON.stringify({
            title: '测试请求数据',
            start: '2025-04-27 18:00:00',
            end: '2025-04-27 19:00:00',
            type: 'important',
            reminder: '2025-04-27 17:00:00',
            description: '测试请求数据',
        }),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    const json = await response.json();
    if (json.id) {
        console.log('添加成功');
    } else {
        console.log('添加失败');
    }
};

addSchedule();