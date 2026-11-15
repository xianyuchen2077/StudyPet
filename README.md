# StudyPet

面向电脑学习的桌宠交互原型，帮助用户明确**目标、眼前行动和检验方式**。用户判断理解、管理任务和决定下一步，桌宠提供暂存、拆小与回顾支持。

当前 **2.4.0** 演示两份真实材料：

- HCI课件：97页分七个板块，提供原文、书签、当前小步和分块回顾。
- 自动控制Homework 7：梳理三题要求、前置知识与六阶段计划；演示止于准备开始，不生成作业答案。

**本版模拟API返回效果，不调用真实API、不需要密钥。** 已配置的密钥也不会用于请求。模拟候选与用户自述分开，确认后才保存。

[简短指南](docs/guide.md) · [两个材料案例](docs/material-cases.md) · [保留的接口说明](docs/deepseek.md)

[下载 Windows 演示包](https://github.com/xianyuchen2077/StudyPet/releases/tag/v2.4.0) · [观看三分钟演示](https://github.com/xianyuchen2077/StudyPet/releases/download/v2.4.0/StudyPet_TwoCases_Demo.mp4) · [仓库内视频](docs/demo/StudyPet_TwoCases_Demo.mp4)

## 运行

完整Windows目录包运行 `StudyPet.exe`，保留同目录文件。源码运行 `npm ci` 后执行 `npm start`；已有依赖可双击 `StudyPet.cmd`。

- `npm run test:study`：全部行为检查。
- `npm run test:cases`：两个材料案例检查。
- `npm run dev`：开发模式。
- `npm run build`：Windows构建。
- `npm run classic`：保留的上游助手模式。

关闭面板后桌宠保留，双击打开，右键菜单退出。计划可修改、排序和合并；只开始所选板块，其余保持待办。暂停、切换和关闭可保留位置与草稿。回顾按板块与轮次保存，不把读完、回顾、掌握和总任务完成混为一谈。

默认资料在 `%APPDATA%/StudyPet-OS-Demo`，旧数据保留。记录与邀请分别控制、默认关闭；不监测其他窗口，不提供专注评分或自动掌握结论。

材料按用户提供的PDF离线准备，乱码文本和图示信息经原件核对，课程内容与图片不代表项目原创。未开展真人可用性或学习成效研究。历史技术说明和视频保留在 `docs/`，不包含本轮全部功能。

基于 [JianguSheng/yuns-desktop-pet](https://github.com/JianguSheng/yuns-desktop-pet) 扩展，保留 [MIT许可证](LICENSE) 和作者署名；原说明见 [上游README](docs/upstream-README.md)。新增实现由Codex辅助并进行自动化与桌面验证。
