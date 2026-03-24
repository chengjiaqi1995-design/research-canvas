# 阿里云OSS配置指南

本指南将帮助您配置阿里云OSS存储，以便通义千问API能够访问您的音频文件。

## 为什么需要配置OSS？

**问题**：阿里云DashScope（通义千问）API的`file_urls`参数要求**公开可访问的HTTP/HTTPS URL**，但：
- 本地文件路径无法被阿里云服务器访问
- Google Cloud Storage URL无法被阿里云服务器访问（跨云网络限制）

**解决方案**：
- **本地开发**：使用临时文件服务（file.io）自动上传（当前默认方案）
- **生产环境**：配置阿里云OSS存储（推荐，稳定可靠）

## 配置步骤

### 1. 创建阿里云OSS存储桶

1. 登录 [阿里云控制台](https://oss.console.aliyun.com/)
2. 进入 **对象存储OSS** 服务
3. 点击 **创建Bucket**
4. 配置：
   - **Bucket名称**：例如 `my-audio-transcription`（全局唯一）
   - **区域**：选择离您最近的区域（例如：华东1-杭州）
   - **读写权限**：选择 **公共读**（允许匿名读取文件）
   - **存储类型**：标准存储
5. 点击 **确定** 创建

### 2. 获取AccessKey

1. 进入 [AccessKey管理页面](https://ram.console.aliyun.com/manage/ak)
2. 点击 **创建AccessKey**
3. 记录下：
   - **AccessKey ID**
   - **AccessKey Secret**（只显示一次，请妥善保存）

⚠️ **安全提示**：
- 不要将AccessKey提交到Git仓库
- 建议使用RAM子账号，仅授予OSS权限
- 定期轮换AccessKey

### 3. 配置环境变量

在 `backend/.env` 文件中添加以下配置：

```bash
# 阿里云OSS配置
ALIYUN_OSS_REGION=oss-cn-hangzhou          # 您的OSS区域
ALIYUN_OSS_ACCESS_KEY_ID=LTAI5t...         # 您的AccessKey ID
ALIYUN_OSS_ACCESS_KEY_SECRET=xxxxx...      # 您的AccessKey Secret
ALIYUN_OSS_BUCKET=my-audio-transcription   # 您的Bucket名称
```

**OSS区域代码对照表**：
| 区域名称 | Region ID |
|---------|-----------|
| 华东1（杭州） | oss-cn-hangzhou |
| 华东2（上海） | oss-cn-shanghai |
| 华北1（青岛） | oss-cn-qingdao |
| 华北2（北京） | oss-cn-beijing |
| 华北3（张家口） | oss-cn-zhangjiakou |
| 华南1（深圳） | oss-cn-shenzhen |
| 华南2（河源） | oss-cn-heyuan |
| 华南3（广州） | oss-cn-guangzhou |

完整列表：https://help.aliyun.com/document_detail/31837.html

### 4. 重启后端服务

```bash
cd backend
npm run dev
```

## 工作流程

配置OSS后，文件上传转录的流程：

```
用户上传音频文件
    ↓
保存到本地 (backend/uploads/)
    ↓
检测到OSS配置 → 上传到阿里云OSS
    ↓
获取公开URL (https://bucket.region.aliyuncs.com/audio/xxx.mp3)
    ↓
传递URL给通义千问API
    ↓
转录完成，返回结果
```

## 未配置OSS的情况

如果未配置OSS，系统会自动使用 **file.io** 临时文件服务：

- ✅ 无需配置，开箱即用
- ⚠️ 文件上传到国外服务器（可能较慢）
- ⚠️ 临时URL有效期：24小时或单次下载
- ⚠️ 不适合生产环境

## 费用说明

阿里云OSS按量计费，费用包括：

1. **存储费用**：约 ¥0.12/GB/月（标准存储）
2. **流量费用**：
   - 内网流量（OSS→DashScope）：免费
   - 外网流量（用户下载）：约 ¥0.5/GB
3. **请求费用**：约 ¥0.01/万次

**示例**：
- 每月上传 100 个音频文件（共 1GB）
- 存储费用：¥0.12
- 转录请求（内网流量）：免费
- 总计：约 **¥0.12/月**

详细价格：https://www.aliyun.com/price/product#/oss/detail

## 常见问题

### Q1: 必须配置OSS吗？

**A**: 不是必须的。
- **本地开发**：可以使用默认的file.io临时服务
- **生产环境**：强烈建议配置OSS，更稳定可靠

### Q2: 可以使用私有Bucket吗？

**A**: 不建议。通义千问API需要公开可访问的URL。如果使用私有Bucket，需要生成带签名的临时URL，增加复杂度。

### Q3: 文件会永久保存在OSS吗？

**A**: 是的。建议配置生命周期规则自动删除旧文件：
1. OSS控制台 → 选择Bucket → 基础设置 → 生命周期
2. 添加规则：30天后自动删除 `audio/` 目录下的文件

### Q4: 可以使用其他云存储吗？

**A**: 可以，只要能提供公开可访问的HTTP/HTTPS URL即可：
- 阿里云OSS（推荐，与千问同云）
- 腾讯云COS
- 七牛云
- 又拍云
- 自建文件服务器（需要公网IP）

### Q5: 如何验证OSS配置是否正确？

**A**: 启动后端服务，查看日志：
```
✅ 阿里云OSS客户端已初始化: my-audio-transcription (oss-cn-hangzhou)
```

上传文件时，日志会显示：
```
📤 检测到阿里云OSS配置，正在上传文件到OSS...
✅ 文件已上传到OSS: https://bucket.region.aliyuncs.com/audio/xxx.mp3
```

## 技术支持

如有问题，请查看：
- [阿里云OSS文档](https://help.aliyun.com/product/31815.html)
- [DashScope API文档](https://help.aliyun.com/zh/dashscope/)

---

**配置完成后，您就可以使用通义千问进行稳定可靠的音频转录了！** 🎉








