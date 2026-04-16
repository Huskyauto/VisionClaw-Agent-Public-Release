# PDF Toolkit Pro

> 📄 一键处理100个PDF文件，合并、分割、压缩、转换全搞定

## 快速开始

### 安装
```bash
npm install
```

### 合并PDF
```bash
node scripts/merge.js input/*.pdf -o output/merged.pdf
```

### 分割PDF
```bash
# 提取1-5页
node scripts/split.js input.pdf -p 1-5 -o output/

# 每页单独保存
node scripts/split.js input.pdf --each -o output/
```

### 压缩PDF
```bash
node scripts/compress.js input.pdf -o output/compressed.pdf
```

### PDF转图片
```bash
node scripts/to-image.js input.pdf -o output/images/ --format png
```

### 批量处理
```bash
node scripts/batch.js input/ -o output/ --operation merge
```

## 功能说明

| 功能 | 命令 | 说明 |
|------|------|------|
| 合并 | merge.js | 多个PDF合并成1个 |
| 分割 | split.js | 提取指定页面 |
| 压缩 | compress.js | 减小文件体积 |
| 转图片 | to-image.js | 导出为PNG/JPG |
| 批量 | batch.js | 批量处理整个文件夹 |

## 价格

- 基础版：¥99
- 专业版：¥199

---

*AI-Company 出品*