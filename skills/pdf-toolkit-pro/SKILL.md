---
name: pdf-toolkit-pro
description: PDF批量处理技能包 - 一键合并、分割、压缩、转换PDF。适合办公人员、文档处理、自动化工作流。
version: 1.0.0
author: AI-Company
tags: [pdf, merge, split, compress, convert, automation, 文档处理, 批量操作]
license: MIT
---

# PDF Toolkit Pro - PDF批量处理技能包

## 一句话介绍
一键处理100个PDF文件，合并、分割、压缩、转换全搞定。

## 解决什么问题？
- 合并PDF：多个PDF要逐个打开？→ 一键合并成1个
- 分割PDF：只要某几页？→ 快速提取指定页面
- 压缩PDF：文件太大发不了邮件？→ 一键压缩50%
- PDF转图片：需要提取内容？→ 批量转换成图片

## 功能清单
- 📄 PDF合并 - 多个PDF合并成1个
- ✂️ PDF分割 - 提取指定页面
- 🗜️ PDF压缩 - 减小文件体积
- 🖼️ PDF转图片 - 导出为PNG/JPG
- 📊 批量处理 - 一次处理整个文件夹
- ⚙️ 自定义配置 - 页面范围、质量、格式

## 快速开始

### 安装
```bash
npm install
```

### 使用

```bash
# 合并PDF
node scripts/merge.js input/*.pdf -o output/merged.pdf

# 分割PDF
node scripts/split.js input.pdf -p 1-5 -o output/

# 压缩PDF
node scripts/compress.js input.pdf -o output/compressed.pdf

# PDF转图片
node scripts/to-image.js input.pdf -o output/images/

# 批量处理
node scripts/batch.js input/ -o output/ --operation merge
```

### 配置示例
```json
{
  "operations": ["merge", "compress"],
  "outputFormat": "pdf",
  "quality": "medium",
  "pageRange": "all",
  "imageFormat": "png",
  "imageDPI": 150
}
```

## 文件结构
```
pdf-toolkit-pro/
├── SKILL.md           # 技能说明
├── README.md          # 产品文档
├── package.json       # 依赖配置
├── scripts/
│   ├── merge.js       # PDF合并
│   ├── split.js       # PDF分割
│   ├── compress.js    # PDF压缩
│   ├── to-image.js    # PDF转图片
│   └── batch.js       # 批量处理
├── templates/
│   └── config.json    # 配置模板
└── examples/
    └── sample.pdf     # 示例文件
```

## 适用人群
- 办公人员
- 文档管理员
- 学生/教师
- 律师/会计
- 设计师

## 价格
- 基础版：¥99（合并+分割+压缩）
- 专业版：¥199（+PDF转图片+批量处理+API接口）

---

*开发者：AI-Company*
*联系：通过ClawHub*