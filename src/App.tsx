import { useState, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, FileText, Image as ImageIcon, Download, Loader2, AlertCircle, Trash2, Info, Settings, Key, Eye, EyeOff, X, SlidersHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYSTEM_INSTRUCTION = `Bạn là hệ thống Trích xuất & Phục dựng tài liệu PDF chuyên nghiệp (Layout-Aware & Math-Aware).
SỨ MỆNH: Khôi phục BÁM SÁT TUYỆT ĐỐI tài liệu gốc (văn bản, bảng biểu, công thức, hình ảnh) và bảo toàn cấu trúc trình bày. Tuyệt đối không làm mất bất kỳ nội dung nào.

YÊU CẦU QUAN TRỌNG:
1. Bảo toàn Layout & Định dạng văn bản (Full-Document Parsing):
   - Giữ nguyên Cấu trúc trang, khoảng cách đoạn, phân cấp tiêu đề (H1, H2, H3).
   - Bảo toàn Căn lề (Trái, Giữa, Phải, Justify). Sử dụng mã HTML để căn lề nếu cần (Ví dụ: <div align="center">Nội dung</div>).
   - Tái tạo CHÍNH XÁC định dạng chữ: In đậm (**text**), In nghiêng (*text*), Gạch chân (dùng thẻ HTML <u>text</u>).
   - Khôi phục các thuộc tính hiển thị nâng cao như Màu sắc, Kích thước font chữ bằng thẻ HTML (Ví dụ: <span style="color: red; font-size: 16px; font-family: Arial;">text</span>).
2. Bảng biểu (Table Structure): BẮT BUỘC tái tạo nguyên vẹn định dạng bảng biểu bằng cú pháp Markdown Table (hoặc thẻ HTML <table> nếu cấu trúc bảng phức tạp). CẤM GOM CHỮ NỘI DUNG BẢNG LẠI THÀNH ĐOẠN VĂN THƯỜNG.
3. Công thức Toán học (Math-Aware): Giữ nguyên khối lượng công thức và chuyển sang LaTeX thuần. Bọc công thức inline bằng $...$ và khối bằng $$...$$. Tuyệt đối cấm làm mất hệ phương trình hay ma trận.
4. Xử lý ảnh: Phân biệt rõ ràng vùng hình minh họa. Ở vị trí nguyên bản của hình ảnh, bạn phải tạo 1 đoạn văn bản trên một dòng riêng: 🔴 CHÈN HÌNH ẢNH + [Mô tả nội dung hình].
5. Tính Toàn vẹn (Zero-Drop Policy): Quét toàn bộ số trang của file. Tuyệt đối cấm nhảy cóc, cấm lược bớt phần phụ lục, bảng biểu hay công thức. CẤM ĐỌC LƯỚT HOẶC TÓM TẮT.

Trả về kết quả ở định dạng Markdown (được phép dùng thẻ HTML nội tuyến để giữ bố cục, định dạng văn bản). Không lồng vào JSON.`;

const USER_PROMPT = `Yêu cầu xử lý toàn vẹn dữ liệu: Trích xuất 100% nội dung và TÁI TẠO CHÍNH XÁC cấu trúc tài liệu PDF gốc. Xử lý triệt để từ trang 1 đến trang cuối cùng.
- Tái tạo trọn vẹn Cấu trúc trang, Bảng biểu, Căn lề, Khoảng cách dòng/đoạn. Không được tóm tắt hay đọc lướt.
- Bảo toàn nguyên gốc định dạng Text: In đậm, In nghiêng, Gạch chân, Màu sắc, Kích thước chữ (Font size).
- Phân biệt vùng chữ và hình. Tại vị trí hình, ghi độc lập "🔴 CHÈN HÌNH ẢNH".
- Chuyển đổi và giữ nguyên cấu trúc Công thức Toán (LaTeX). CẤM làm hỏng hoặc thay đổi cơ chế công thức toán học.`;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState<string>('');
  const deferredResult = useDeferredValue(result);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApi, setShowApi] = useState(false);

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', apiKeyInput);
    setIsSettingsModalOpen(false);
  };

  const handleBackup = () => {
    const data = { gemini_api_key: localStorage.getItem('gemini_api_key') || '' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aistudio_settings_backup.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target?.result as string);
            if (data.gemini_api_key !== undefined) {
              setApiKeyInput(data.gemini_api_key);
              localStorage.setItem('gemini_api_key', data.gemini_api_key);
              alert('Phục hồi dữ liệu thành công!');
            }
          } catch (err) {
            alert('File sao lưu không hợp lệ!');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleDeleteData = () => {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu cài đặt khỏi trình duyệt không?')) {
      localStorage.removeItem('gemini_api_key');
      setApiKeyInput('');
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleFileSelection = (selectedFile: File) => {
    setError(null);
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!validTypes.includes(selectedFile.type)) {
      setError('Vui lòng tải lên file PDF hoặc Hình ảnh (JPG, PNG, WEBP).');
      return;
    }
    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('Kích thước file vượt quá 50MB.');
      return;
    }
    setFile(selectedFile);
    setResult('');
  };

  const clearFile = () => {
    setFile(null);
    setResult('');
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
    
    return {
      inlineData: {
        data: await base64EncodedDataPromise,
        mimeType: file.type
      }
    };
  };

  const extractText = async () => {
    if (!file) return;
    
    setIsExtracting(true);
    setError(null);
    setResult('');
    
    try {
      const configApiKey = localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY;
      if (!configApiKey) {
        setError('Vui lòng vào Cài đặt Hệ thống để nhập Google Gemini API Key trước khi sử dụng.');
        setIsExtracting(false);
        return;
      }

      const ai = new GoogleGenAI({ 
        apiKey: configApiKey,
        httpOptions: { timeout: 600000 } // Timeout 600 giây (10 phút) để xử lý triệt để file cực lớn
      });
      const filePart = await fileToGenerativePart(file);
      
      const configObj = {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0, // Strict deterministic classification
        responseMimeType: "text/plain",
      };

      let activeChat = ai.chats.create({
        model: 'gemini-3.1-pro-preview', // Đảm bảo tốc độ và năng lực truy xuất chính xác tối đa
        config: configObj
      });

      let fullText = '';
      let lastUIUpdate = Date.now();
      let isDone = false;
      let loopCount = 0;
      let currentMessage: any = [filePart, { text: USER_PROMPT }];

      while (!isDone && loopCount < 10) {
        loopCount++;
        let responseStream;
        try {
          responseStream = await activeChat.sendMessageStream({ message: currentMessage });
        } catch (firstErr: any) {
          const firstErrStr = typeof firstErr === 'object' ? JSON.stringify(firstErr) : String(firstErr);
          if (loopCount === 1 && (firstErrStr.includes('429') || firstErrStr.includes('quota') || firstErrStr.includes('RESOURCE_EXHAUSTED'))) {
            activeChat = ai.chats.create({
              model: 'gemini-3-flash-preview',
              config: configObj
            });
            responseStream = await activeChat.sendMessageStream({ message: currentMessage });
          } else {
            throw firstErr;
          }
        }

        let stopReason: string | undefined = undefined;
        let chunkTextLoop = '';
        
        for await (const chunk of responseStream) {
          const textChunk = chunk.text;
          if (chunk.candidates && chunk.candidates.length > 0 && chunk.candidates[0].finishReason) {
             stopReason = chunk.candidates[0].finishReason;
          }
          if (textChunk) {
            fullText += textChunk;
            chunkTextLoop += textChunk;
            
            // Thuật toán Batching Render: Tích lũy tối thiểu 100ms mới đẩy state 1 lần
            if (Date.now() - lastUIUpdate > 100) {
              setResult(fullText);
              lastUIUpdate = Date.now();
            }
          }
        }

        if (stopReason === 'MAX_TOKENS') {
          currentMessage = { text: "Hệ thống ghi nhận bạn đã tạm dừng do hết bộ nhớ đầu ra. Hãy rà soát lại văn bản và tiếp tục trích xuất CHÍNH XÁC TỪ ĐIỂM DỪNG, tuyệt đối không lặp lại đoạn trên, không tóm tắt, xuất tiếp tuần tự từng trang cho đến khi kết thúc 100% tài liệu." };
        } else if (!chunkTextLoop.trim()) {
          isDone = true;
        } else {
          isDone = true;
        }
      }
      
      setResult(fullText);
    } catch (err: any) {
      console.error('Extraction error:', err);
      const errorString = typeof err === 'object' ? JSON.stringify(err) : String(err);
      
      if (errorString.includes('429') || errorString.includes('quota') || errorString.includes('RESOURCE_EXHAUSTED')) {
        setError('Tất cả hệ thống AI đều đang bị quá giới hạn truy cập (Lỗi Quota 429 do cạn lượt dùng miễn phí). Vui lòng đợi vài phút và thử lại.');
      } else if (errorString.includes('500') || errorString.includes('status code: 0')) {
        setError('Đường truyền bị từ chối hoặc máy chủ Google đang quá tải (Lỗi 500/Network Error). Vui lòng kiểm tra mạng và thử lại sau ít phút.');
      } else {
        setError((typeof err.message === 'string' ? err.message : '') || 'Xảy ra lỗi mạng do đường truyền. Vui lòng thử lại.');
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const parsedMarkdown = useMemo(() => {
    // 💡 Sử dụng deferredResult thay vì result để cho phép Render ngầm không giật lag Main Thread
    if (!deferredResult) return null;
    
    // Sử dụng Regex để bao bọc vị trí "🔴 CHÈN HÌNH ẢNH" thành thẻ định dạng đỏ thay vì áp dụng cho cả toàn bộ khối paragraph.
    const processedResult = deferredResult.replace(/(🔴 CHÈN HÌNH ẢNH.*?)(\n|$)/g, '<span style="color: red; font-weight: bold;">$1</span>$2');

    return (
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]} 
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          table: ({ node, ...props }) => <table {...props} className="border-collapse border border-white/20 my-4 w-full text-slate-200" />,
          th: ({ node, ...props }) => <th {...props} className="border border-white/20 p-2 bg-white/10 font-bold text-left text-white" />,
          td: ({ node, ...props }) => <td {...props} className="border border-white/20 p-2 text-left" />
        }}
      >
        {processedResult}
      </ReactMarkdown>
    );
  }, [deferredResult]);

  const downloadWord = () => {
    if (!result) return;
    
    const contentElement = document.getElementById('preview-content');
    if (!contentElement) return;

    // Clone DOM map để làm sạch rác hiển thị trước khi đẩy ra cấu trúc Word
    const clone = contentElement.cloneNode(true) as HTMLElement;

    // KIẾN TRÚC FIX WORD MATH: Phá bỏ toàn bộ HTML giả định, chỉ giữ lại gốc MathML cho Word dịch
    const katexHtmls = clone.querySelectorAll('.katex-html');
    katexHtmls.forEach(el => el.parentNode?.removeChild(el));

    const katexMathmls = clone.querySelectorAll('.katex-mathml');
    katexMathmls.forEach(el => {
      // Ép hiển thị MathML nguyên khối
      (el as HTMLElement).style.display = 'block'; 
    });

    // Ép fix các thẻ Heading, thẻ p để Word nhận dạng đúng lề
    const allTags = clone.querySelectorAll('h1, h2, h3, p, div, span');
    allTags.forEach(el => {
       const htmlEl = el as HTMLElement;
       const inlineAlign = htmlEl.style.textAlign || htmlEl.getAttribute('align');
       
       if (inlineAlign === 'center') {
          htmlEl.setAttribute('align', 'center');
       } else if (inlineAlign === 'right') {
          htmlEl.setAttribute('align', 'right');
       } else if (inlineAlign === 'justify') {
           htmlEl.setAttribute('align', 'justify');
       }
    });

    const contentHtml = clone.innerHTML;
    
    // Create HTML document with Word XML namespaces and styles
    const preHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns:m='http://schemas.microsoft.com/office/2004/12/omml' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Export</title>
      <style>
        body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1em; border: 1px solid black; }
        th, td { border: 1px solid black; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        h1 { font-size: 24pt; font-weight: bold; margin-bottom: 12pt; }
        h2 { font-size: 18pt; font-weight: bold; margin-bottom: 10pt; }
        h3 { font-size: 14pt; font-weight: bold; margin-bottom: 8pt; }
        p { margin-bottom: 10pt; }
        /* Trick to get native Word equations: hide HTML, show MathML */
        .katex-html { display: none; }
        .katex-mathml { display: block; }
        .image-placeholder { border: 2px solid red; color: red; font-weight: bold; padding: 12px; margin-bottom: 1em; }
      </style>
    </head>
    <body>`;
    const postHtml = "</body></html>";
    const html = preHtml + contentHtml + postHtml;

    const blob = new Blob(['\\ufeff', html], {
      type: 'application/msword'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file ? `${file.name.split('.')[0]}_extracted.doc` : 'extracted_document.doc';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-white">
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20 sticky top-0 z-10 shadow-lg">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2.5 rounded-xl shadow-inner backdrop-blur-sm border border-white/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-semibold text-lg tracking-tight text-white drop-shadow-md">OCR & Word Extractor</h1>
              <p className="text-xs font-medium text-slate-300 mt-0.5">ứng dụng được phát triển bởi thầy giáo Lê Văn Phi</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-white/80 hidden sm:block bg-white/10 px-3 py-1.5 rounded-full border border-white/20 backdrop-blur-sm shadow-sm">
              Powered by Gemini 2.5 Pro (Smart Engine)
            </div>
            <button 
              onClick={() => setIsSettingsModalOpen(true)}
              className="bg-white/20 p-2 rounded-xl shadow-inner backdrop-blur-sm border border-white/20 hover:bg-white/30 transition-colors"
              title="Cài đặt Hệ thống"
            >
              <Settings className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Upload & Instructions */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
              <div className="p-5 border-b border-white/10 bg-white/5">
                <h2 className="font-medium text-white drop-shadow-sm">Tải lên tài liệu</h2>
                <p className="text-sm text-slate-300 mt-1">Hỗ trợ PDF (kể cả PDF scan/ảnh), JPG, PNG</p>
              </div>
              
              <div className="p-5">
                {!file ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300",
                      isDragging 
                        ? "border-indigo-400 bg-indigo-500/20 backdrop-blur-md" 
                        : "border-white/30 hover:border-white/60 hover:bg-white/10 backdrop-blur-sm"
                    )}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                      className="hidden"
                    />
                    <div className="mx-auto w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-4 shadow-inner">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                    <p className="text-sm font-medium text-slate-200">
                      Kéo thả file vào đây hoặc click để chọn
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center p-4 bg-white/10 backdrop-blur-md rounded-xl border border-white/20 shadow-inner">
                      <div className="mr-4">
                        {file.type === 'application/pdf' ? (
                          <FileText className="w-8 h-8 text-rose-400 drop-shadow-md" />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-sky-400 drop-shadow-md" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate drop-shadow-sm">
                          {file.name}
                        </p>
                        <p className="text-xs text-slate-300">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        onClick={clearFile}
                        className="p-2 text-slate-300 hover:text-rose-400 hover:bg-white/10 rounded-lg transition-colors"
                        title="Xóa file"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>

                    <button
                      onClick={extractText}
                      disabled={isExtracting}
                      className={cn(
                        "w-full py-3 px-4 rounded-xl font-medium text-white shadow-lg transition-all flex items-center justify-center gap-2 border border-white/20 backdrop-blur-md",
                        isExtracting 
                          ? "bg-indigo-500/50 cursor-not-allowed" 
                          : "bg-indigo-500/80 hover:bg-indigo-500 hover:shadow-indigo-500/50 active:transform active:scale-[0.98]"
                      )}
                    >
                      {isExtracting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Đang xử lý...
                        </>
                      ) : (
                        <>
                          <FileText className="w-5 h-5" />
                          Bắt đầu trích xuất
                        </>
                      )}
                    </button>
                  </div>
                )}

                {error && (
                  <div className="mt-4 p-3 bg-rose-500/20 border border-rose-500/30 backdrop-blur-md rounded-lg flex items-start gap-3 text-rose-200">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-5 border border-white/20 shadow-2xl">
              <div className="flex items-center gap-2 mb-4 text-cyan-300">
                <Info className="w-5 h-5" />
                <h3 className="font-medium drop-shadow-sm flex-1">Hướng dẫn sử dụng</h3>
              </div>
              <ul className="text-sm text-slate-200 space-y-4 list-none">
                <li className="flex gap-3">
                  <span className="bg-white/20 text-white font-medium rounded-full w-6 h-6 flex items-center justify-center shrink-0 text-xs shadow-inner border border-white/10">1</span>
                  <span className="leading-relaxed">Bấm vào biểu tượng <Settings className="w-4 h-4 inline-block align-sub mx-0.5 text-white" /> góc phải phía trên để mở <strong>Cài đặt Hệ thống</strong>.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-white/20 text-white font-medium rounded-full w-6 h-6 flex items-center justify-center shrink-0 text-xs shadow-inner border border-white/10">2</span>
                  <span className="leading-relaxed">Nhấn qua thiết lập, điền <strong>Google Gemini API Key</strong>. Key của bạn sẽ được lưu siêu an toàn theo cơ chế LocalStorage tại trình duyệt web, chúng tôi không có quyền truy cập Key của bạn.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-white/20 text-white font-medium rounded-full w-6 h-6 flex items-center justify-center shrink-0 text-xs shadow-inner border border-white/10">3</span>
                  <span className="leading-relaxed">Sử dụng tính năng <strong>Quản lý Dữ liệu</strong> trong Cài đặt Hệ thống để <strong>Sao lưu</strong> Key sau đó <strong>Phục hồi</strong> trên thiết bị máy tính khác hoặc <strong>Xóa dữ liệu</strong> dễ dàng bất kì lúc nào.</span>
                </li>
                <li className="flex gap-3">
                  <span className="bg-white/20 text-white font-medium rounded-full w-6 h-6 flex items-center justify-center shrink-0 text-xs shadow-inner border border-white/10">4</span>
                  <span className="leading-relaxed">Sau khi cấu hình, hãy tải lên tập tin và chờ AI xử lý. Chế độ đọc file cực sâu không giới hạn giúp xử lý những nội dung PDF rất phức tạp!</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8 flex flex-col h-[500px] lg:h-[calc(100vh-8rem)]">
            <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 flex flex-col h-full overflow-hidden">
              
              {/* Header & Actions */}
              <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
                <h2 className="font-medium text-white drop-shadow-sm flex items-center gap-2">
                  Chế độ xem trước
                </h2>
                
                <button
                  onClick={downloadWord}
                  disabled={!result || isExtracting}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all backdrop-blur-md border",
                    !result || isExtracting
                      ? "text-slate-400 bg-white/5 border-white/5 cursor-not-allowed"
                      : "bg-indigo-500/80 text-white border-white/20 hover:bg-indigo-500 hover:shadow-indigo-500/50"
                  )}
                >
                  <Download className="w-4 h-4" />
                  Tải file Word
                </button>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-auto bg-slate-900/40 relative">
                {!result && !isExtracting ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                    <FileText className="w-16 h-16 mb-4 opacity-30 drop-shadow-md" />
                    <p className="text-lg font-medium text-slate-300">Chưa có dữ liệu</p>
                    <p className="text-sm mt-1 max-w-sm text-slate-400">
                      Tải file lên và bấm trích xuất để xem trước kết quả tại đây.
                    </p>
                  </div>
                ) : (
                  <div className="p-8 h-full text-slate-100">
                    <div 
                      id="preview-content"
                      className="prose prose-invert max-w-none prose-headings:font-semibold prose-a:text-indigo-400 prose-pre:bg-black/50 prose-pre:text-slate-50 prose-td:border-white/20 prose-th:border-white/20 prose-th:bg-white/10"
                    >
                      {isExtracting ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm z-10 transition-opacity">
                          <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mb-4" />
                          <p className="font-medium text-lg drop-shadow-md">Đang phân tích layout khối JSON...</p>
                        </div>
                      ) : null}
                      {parsedMarkdown}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
        </div>
      </main>

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl w-full max-w-[440px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.15)] relative text-slate-800 flex flex-col pt-1">
            
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3 text-[#1e293b] font-semibold text-[17px]">
                <SlidersHorizontal className="w-5 h-5 text-blue-600 outline-none" strokeWidth={2.5} />
                Cài đặt Hệ thống
              </div>
              <button 
                onClick={() => setIsSettingsModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-1.5 rounded-full transition-colors outline-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="px-6 py-6 space-y-6">
              <div>
                <label className="block text-sm font-[500] text-slate-700 mb-2.5">Google Gemini API Key</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                    <Key className="w-4 h-4" />
                  </div>
                  <input 
                    type={showApi ? "text" : "password"} 
                    value={apiKeyInput}
                    onChange={e => setApiKeyInput(e.target.value)}
                    className="w-full pl-10 pr-11 py-2.5 border border-slate-200 rounded-xl text-[15px] font-medium tracking-wide focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-slate-800 transition-shadow"
                    placeholder="Nhập API Key của bạn..."
                  />
                  <button 
                    onClick={() => setShowApi(!showApi)} 
                    className="absolute right-3.5 text-slate-400 hover:text-slate-600 transition-colors bg-white p-1 rounded outline-none"
                  >
                    {showApi ? <EyeOff className="w-[18px] h-[18px]" strokeWidth={2.5} /> : <Eye className="w-[18px] h-[18px]" strokeWidth={2.5} />}
                  </button>
                </div>
                <p className="text-[13px] text-slate-500 mt-2.5 leading-[1.6]">
                  API Key được lưu an toàn cục bộ (LocalStorage) trên trình duyệt của bạn. <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-600 hover:underline">Lấy API Key tại đây.</a>
                </p>
              </div>

              <div>
                <label className="block text-sm font-[500] text-slate-700 mb-3">Quản lý Dữ liệu</label>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <button 
                    onClick={handleBackup} 
                    className="flex items-center justify-center gap-2.5 py-3 bg-blue-50/70 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors font-medium text-sm border-blue-50/80 outline-none"
                  >
                    <Download className="w-[18px] h-[18px]" strokeWidth={2} /> Sao lưu
                  </button>
                  <button 
                    onClick={handleRestore} 
                    className="flex items-center justify-center gap-2.5 py-3 bg-emerald-50/70 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-colors font-medium text-sm outline-none"
                  >
                    <Upload className="w-[18px] h-[18px]" strokeWidth={2} /> Phục hồi
                  </button>
                </div>
                <button 
                  onClick={handleDeleteData} 
                  className="w-full flex items-center justify-center gap-2.5 py-3 bg-[#fff1f2] text-[#e11d48] rounded-xl hover:bg-rose-100 transition-colors font-medium text-sm outline-none"
                >
                  <Trash2 className="w-[18px] h-[18px]" strokeWidth={2} /> Xóa dữ liệu hệ thống
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 pt-2 bg-white flex items-center justify-center gap-8 sm:justify-end sm:gap-4">
              <button 
                onClick={() => setIsSettingsModalOpen(false)} 
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors outline-none"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={saveSettings} 
                className="px-6 py-2.5 text-[15px] font-medium bg-[#3b82f6] text-white rounded-xl hover:bg-blue-600 shadow-sm transition-colors outline-none"
              >
                Lưu cài đặt
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
