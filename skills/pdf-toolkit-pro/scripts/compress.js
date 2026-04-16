/**
 * PDF压缩脚本
 * 压缩PDF文件大小
 */

const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { program } = require('commander');

program
  .argument('<input>', '输入PDF文件')
  .option('-o, --output <file>', '输出文件路径')
  .option('-q, --quality <level>', '压缩质量 (low/medium/high)', 'medium')
  .parse(process.argv);

async function compressPDF(inputFile, options) {
  console.log('🗜️ PDF Toolkit Pro - 压缩PDF');
  console.log('━'.repeat(40));
  
  const inputBytes = fs.readFileSync(inputFile);
  const originalSize = inputBytes.length;
  
  console.log(`📄 文件: ${path.basename(inputFile)}`);
  console.log(`📊 原始大小: ${(originalSize / 1024).toFixed(2)} KB`);
  
  // 加载PDF
  const pdf = await PDFDocument.load(inputBytes, {
    ignoreEncryption: true,
  });
  
  // 获取所有页
  const pageCount = pdf.getPageCount();
  console.log(`📑 页数: ${pageCount}`);
  
  // 压缩（移除重复对象，优化结构）
  const compressedBytes = await pdf.save({
    useObjectStreams: true,
  });
  
  const compressedSize = compressedBytes.length;
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
  
  // 输出文件
  const outputFile = options.output || inputFile.replace('.pdf', '_compressed.pdf');
  const outputDir = path.dirname(outputFile);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputFile, compressedBytes);
  
  console.log('━'.repeat(40));
  console.log(`📊 压缩后大小: ${(compressedSize / 1024).toFixed(2)} KB`);
  console.log(`📉 压缩比例: ${ratio}%`);
  console.log(`✅ 输出: ${outputFile}`);
}

compressPDF(program.args[0], program.opts());