# Haibao English Quest

一个面向小学中高年级的英语学习网站，现已升级为“前端 + 后端 + SQLite”的正式系统，包含：

- 学生端闯关地图、学习站、家长报告
- 正式学科《海宝体验课》
- 管理员初始化与登录
- 学科管理、教材图片库、单元草稿编辑、发布
- OpenAI / Qwen / 阿里云 OCR 设置
- token 与估算费用日志

## 一键启动

```bash
npm install
npm run dev
```

- 前端开发地址默认：`https://localhost:3133`
- 后端 API 默认：`https://localhost:3135`
- 前端已配置局域网监听；同局域网设备可用你的本机 IP 访问前端端口

说明：
- 开发和生产启动都会自动生成本地自签名证书，证书文件位于 `data/certs/`。
- 浏览器第一次访问本地 HTTPS 时，可能会提示证书不受信任，确认继续访问即可。
- 如果 `3133` 已被其他程序占用，Vite 会自动回退到别的端口，实际端口以终端输出为准。
- 第一次进入“内容后台”时，需要先初始化管理员账号。

## 一键测试

```bash
npm run test
```

## 一键构建

```bash
npm run build
```

## 生产启动

```bash
npm run build
npm run start
```

## 当前实现范围

- 正式学科《海宝体验课》与一组原创框架单元
- 图片上传 -> OCR -> LLM 生成单元草稿 -> 人工校对 -> 发布 的完整后端流程
- OpenAI 使用官方 Responses API
- OpenAI 设置页已按官方文档收紧为下拉选择，避免传入无效参数
- Qwen 支持原生模式与兼容模式切换
- 阿里云 OCR 走真实 SDK 接入
- 所有供应商配置项都可在后台编辑
- 记录调用时间、功能、供应商、模型、token 数与估算费用

## 需要你后续配置的内容

- 管理员账号：首次启动后在后台初始化
- OpenAI API Key 与模型参数
- Qwen API Key / endpoint / 模型参数
- 阿里云 OCR AccessKeyId / AccessKeySecret / endpoint / region
- 如需更准确的费用统计，请在后台把各供应商单价配置完整

## 关键目录

- `server/`: 后端、数据库、OCR/模型适配层
- `src/App.tsx`: 前端主界面与后台页面
- `src/api.ts`: 前端 API 调用
- `src/learning-progress.ts`: 学习进度本地存储
- `src/types.ts`: 前端共享类型
