"use client"
import React, { useState, useRef, useEffect } from 'react';
import { Upload, Send, Square, FileText, Plus, Search, MoreVertical, X } from 'lucide-react';

// Simple markdown renderer for formatting responses
const MarkdownRenderer = ({ content }: { content: string }) => {
  const formatText = (text: string) => {
    // Handle bold text
    let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Handle italic text
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Handle code blocks
    formatted = formatted.replace(/`(.*?)`/g, '<code class="bg-gray-800 px-2 py-1 rounded text-gray-300">$1</code>');
    // Handle line breaks
    formatted = formatted.replace(/\n/g, '<br/>');
    
    return formatted;
  };

  return (
    <div 
      className="text-gray-200 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: formatText(content) }}
    />
  );
};

interface QAResult {
  answer: string;
  sources: any[];
  confidence: number;
  metadata?: {
    retrievalTime: number;
    generationTime: number;
    chunksUsed: number;
  };
}

interface ChatMessage {
  id: string;
  question: string;
  answer?: QAResult;
  streamingAnswer?: string;
  isStreaming?: boolean;
  timestamp: number;
}

interface Stats {
  totalPoints: number;
  vectorsCount: number;
  collectionName: string;
  isReady: boolean;
}

interface UploadedFile {
  name: string;
  size: number;
  uploadedAt: number;
}

export default function RAGApp() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  
  const [question, setQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load chat history and uploaded files from memory on component mount
  useEffect(() => {
    const savedMessages = JSON.parse(sessionStorage.getItem('ragChatHistory') || '[]');
    const savedFiles = JSON.parse(sessionStorage.getItem('ragUploadedFiles') || '[]');
    setChatMessages(savedMessages);
    setUploadedFiles(savedFiles);
    fetchStats();
  }, []);

  // Save chat history to memory whenever it changes
  useEffect(() => {
    sessionStorage.setItem('ragChatHistory', JSON.stringify(chatMessages));
  }, [chatMessages]);

  // Save uploaded files to memory whenever it changes
  useEffect(() => {
    sessionStorage.setItem('ragUploadedFiles', JSON.stringify(uploadedFiles));
  }, [uploadedFiles]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.type === 'application/pdf' || droppedFile.type === 'text/plain')) {
      setFile(droppedFile);
    }
  };

  const handleFileUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadStatus('');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      
      if (result.success) {
        setUploadStatus('File uploaded successfully!');
        
        // Add to uploaded files list
        const newFile: UploadedFile = {
          name: file.name,
          size: file.size,
          uploadedAt: Date.now()
        };
        setUploadedFiles(prev => [...prev, newFile]);
        
        fetchStats();
        setFile(null);
        
        // Clear status after 3 seconds
        setTimeout(() => setUploadStatus(''), 3000);
      } else {
        setUploadStatus('Error: ' + result.message);
      }
    } catch (error) {
      setUploadStatus('Upload failed: ' + error);
    } finally {
      setUploading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/stats');
      const result = await response.json();
      setStats(result);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const handleStreamQuery = async () => {
    if (!question.trim()) return;

    const messageId = Date.now().toString();
    const newMessage: ChatMessage = {
      id: messageId,
      question: question.trim(),
      isStreaming: true,
      streamingAnswer: '',
      timestamp: Date.now()
    };

    setChatMessages(prev => [...prev, newMessage]);
    setQuestion(''); // Clear input immediately
    setLoading(true);
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: newMessage.question }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Stream request failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No reader available');
      }

      let fullAnswer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.chunk) {
                fullAnswer += data.chunk;
                setChatMessages(prev => 
                  prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, streamingAnswer: fullAnswer }
                      : msg
                  )
                );
              } else if (data.done) {
                setChatMessages(prev => 
                  prev.map(msg => 
                    msg.id === messageId 
                      ? { 
                          ...msg, 
                          isStreaming: false,
                          answer: {
                            answer: fullAnswer,
                            sources: data.sources || [],
                            confidence: data.confidence || 0,
                            metadata: data.metadata
                          }
                        }
                      : msg
                  )
                );
                setLoading(false);
                return;
              }
            } catch (e) {
              console.error('Error parsing stream data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Stream failed:', error);
        setChatMessages(prev => 
          prev.map(msg => 
            msg.id === messageId 
              ? { 
                  ...msg, 
                  isStreaming: false,
                  answer: {
                    answer: 'Error: Failed to get response',
                    sources: [],
                    confidence: 0
                  }
                }
              : msg
          )
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
    setChatMessages(prev => 
      prev.map(msg => 
        msg.isStreaming 
          ? { ...msg, isStreaming: false }
          : msg
      )
    );
    setLoading(false);
  };

  const clearChat = () => {
    setChatMessages([]);
    sessionStorage.removeItem('ragChatHistory');
  };

  const removeFile = (fileName: string) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const currentStreaming = chatMessages.some(msg => msg.isStreaming);

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sources Panel */}
      <div className="w-1/2 border-r border-gray-800 flex flex-col">
        {/* Header - Sticky */}
        <div className="sticky top-0 bg-black z-10 p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-white text-lg font-medium">Sources</h1>
            <button className="text-gray-400 hover:text-white">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => document.getElementById('file-input')?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 rounded-full hover:bg-gray-700 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 rounded-full hover:bg-gray-700 transition-colors text-sm">
              <Search className="w-4 h-4" />
              Discover
            </button>
          </div>
        </div>

        {/* Sources Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {uploadedFiles.length > 0 ? (
            <div className="p-4 space-y-3">
              <div className="text-sm text-gray-400 mb-4">
                {uploadedFiles.length} source{uploadedFiles.length > 1 ? 's' : ''} uploaded
              </div>
              
              {uploadedFiles.map((file, index) => (
                <div key={index} className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
                      <FileText className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-white text-sm font-medium">{file.name}</div>
                      <div className="text-gray-400 text-xs">
                        {(file.size / 1024 / 1024).toFixed(2)} MB • {new Date(file.uploadedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(file.name)}
                    className="text-gray-400 hover:text-red-400 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="w-16 h-16 bg-gray-800 rounded-lg flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-gray-600" />
              </div>
              <h3 className="text-gray-300 font-medium mb-2">Saved sources will appear here</h3>
              <p className="text-gray-500 text-sm text-center max-w-xs">
                Click Add source above to add PDFs, websites, text, videos, or audio files. Or import a file directly from Google Drive.
              </p>
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          id="file-input"
          type="file"
          accept=".pdf,.txt"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="hidden"
        />

        {/* Upload Modal/Area - Sticky at bottom */}
        {file && (
          <div className="sticky bottom-0 bg-gray-900 p-4 border-t border-gray-800">
            <div className="mb-3">
              <p className="text-white text-sm font-medium">{file.name}</p>
              <p className="text-gray-400 text-xs">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button
              onClick={handleFileUpload}
              disabled={uploading}
              className="w-full bg-white text-black px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-gray-100 transition-colors text-sm font-medium"
            >
              {uploading ? 'Processing...' : 'Upload & Process'}
            </button>
            {uploadStatus && (
              <p className={`text-xs mt-2 ${uploadStatus.includes('successfully') ? 'text-green-400' : 'text-red-400'}`}>
                {uploadStatus}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Chat Panel */}
      <div className="w-1/2 flex flex-col">
        {/* Header - Sticky */}
        <div className="sticky top-0 bg-black z-10 p-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <h1 className="text-white text-lg font-medium">Chat</h1>
            {chatMessages.length > 0 && (
              <button 
                onClick={clearChat}
                className="text-gray-400 hover:text-red-400 text-sm"
              >
                Clear Chat
              </button>
            )}
          </div>
        </div>

        {/* Chat Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {chatMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 h-full">
              <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-gray-300 font-medium mb-2">Add a source to get started</h3>
              <button 
                onClick={() => document.getElementById('file-input')?.click()}
                className="px-6 py-2 border border-gray-600 text-gray-300 rounded-full hover:bg-gray-800 transition-colors"
              >
                Upload a source
              </button>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {chatMessages.map((message) => (
                <div key={message.id} className="space-y-3">
                  {/* Question */}
                  <div className="bg-blue-900 bg-opacity-50 rounded-lg p-4 ml-8">
                    <p className="text-blue-100">{message.question}</p>
                  </div>
                  
                  {/* Answer */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    {message.answer ? (
                      <>
                        <MarkdownRenderer content={message.answer.answer} />
                        <div className="flex gap-4 text-xs text-gray-500 mt-3">
                          <span>Confidence: {(message.answer.confidence * 100).toFixed(1)}%</span>
                          <span>Sources: {message.answer.sources?.length || 0}</span>
                          {message.answer.metadata && (
                            <span>{message.answer.metadata.retrievalTime + message.answer.metadata.generationTime}ms</span>
                          )}
                        </div>
                      </>
                    ) : message.streamingAnswer ? (
                      <>
                        <MarkdownRenderer content={message.streamingAnswer} />
                        {message.isStreaming && <span className="animate-pulse text-gray-400">|</span>}
                      </>
                    ) : message.isStreaming ? (
                      <div className="text-gray-400">Starting to generate answer...</div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input Area - Sticky at bottom */}
        <div className="sticky bottom-0 bg-black p-4 border-t border-gray-800">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!currentStreaming && question.trim()) {
                      handleStreamQuery();
                    }
                  }
                }}
                placeholder={uploadedFiles.length > 0 ? "Ask a question..." : "Upload a source to get started"}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-4 py-3 pr-12 resize-none focus:ring-1 focus:ring-gray-600 focus:border-gray-600 placeholder-gray-500"
                rows={1}
                style={{minHeight: '44px'}}
                disabled={currentStreaming}
              />
              <div className="absolute right-2 top-2 text-gray-500 text-xs">
                {uploadedFiles.length} source{uploadedFiles.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button
              onClick={currentStreaming ? stopStreaming : (question.trim() ? handleStreamQuery : undefined)}
              disabled={!question.trim() && !currentStreaming}
              className="w-12 h-12 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700 transition-colors flex items-center justify-center"
            >
              {currentStreaming ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}