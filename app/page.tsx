"use client"
import React, { useState, useRef } from 'react';
import { Upload, Send, Square, FileText, Plus, Search, MoreVertical } from 'lucide-react';

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

interface Stats {
  totalPoints: number;
  vectorsCount: number;
  collectionName: string;
  isReady: boolean;
}

export default function RAGApp() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<QAResult | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

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
        fetchStats();
        setFile(null);
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

  const handleQuery = async () => {
    if (!question.trim()) return;

    setLoading(true);
    setAnswer(null);

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });

      const result = await response.json();
      setAnswer(result);
    } catch (error) {
      console.error('Query failed:', error);
      alert('Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStreamQuery = async () => {
    if (!question.trim()) return;

    setIsStreaming(true);
    setStreamingAnswer('');
    
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
        body: JSON.stringify({ question }),
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
                setStreamingAnswer(prev => prev + data.chunk);
              } else if (data.done) {
                setIsStreaming(false);
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
        alert('Stream failed');
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sources Panel */}
      <div className="w-1/2 border-r border-gray-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
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

        {/* Sources Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {stats && stats.totalPoints > 0 ? (
            <div className="w-full space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{stats.totalPoints}</div>
                <div className="text-gray-400">Documents uploaded</div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-8">
                <div className="bg-gray-900 p-3 rounded-lg">
                  <div className="text-lg font-bold text-white">{stats.vectorsCount}</div>
                  <div className="text-xs text-gray-400">Vectors</div>
                </div>
                <div className="bg-gray-900 p-3 rounded-lg">
                  <div className={`text-lg font-bold ${stats.isReady ? 'text-green-400' : 'text-red-400'}`}>
                    {stats.isReady ? '✓' : '✗'}
                  </div>
                  <div className="text-xs text-gray-400">Status</div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 bg-gray-800 rounded-lg flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-gray-600" />
              </div>
              <h3 className="text-gray-300 font-medium mb-2">Saved sources will appear here</h3>
              <p className="text-gray-500 text-sm text-center max-w-xs">
                Click Add source above to add PDFs, websites, text, videos, or audio files. Or import a file directly from Google Drive.
              </p>
            </>
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

        {/* Upload Modal/Area */}
        {file && (
          <div className="p-4 border-t border-gray-800 bg-gray-900">
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
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-white text-lg font-medium">Chat</h1>
        </div>

        {/* Chat Content */}
        <div className="flex-1 flex flex-col">
          {!answer && !streamingAnswer && !isStreaming ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
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
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Regular Answer */}
              {answer && (
                <div className="bg-gray-900 rounded-lg p-4">
                  <MarkdownRenderer content={answer.answer} />
                  <div className="flex gap-4 text-xs text-gray-500 mt-3">
                    <span>Confidence: {(answer.confidence * 100).toFixed(1)}%</span>
                    <span>Sources: {answer.sources?.length || 0}</span>
                    {answer.metadata && (
                      <span>{answer.metadata.retrievalTime + answer.metadata.generationTime}ms</span>
                    )}
                  </div>
                </div>
              )}

              {/* Streaming Answer */}
              {(streamingAnswer || isStreaming) && (
                <div className="bg-gray-900 rounded-lg p-4">
                  <MarkdownRenderer content={streamingAnswer || 'Starting to generate answer...'} />
                  {isStreaming && <span className="animate-pulse text-gray-400">|</span>}
                </div>
              )}
            </div>
          )}

          {/* Input Area */}
          <div className="p-4 border-t border-gray-800">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Upload a source to get started"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg text-white px-4 py-3 pr-12 resize-none focus:ring-1 focus:ring-gray-600 focus:border-gray-600 placeholder-gray-500"
                  rows={1}
                  style={{minHeight: '44px'}}
                />
                <div className="absolute right-2 top-2 text-gray-500 text-xs">
                  0 sources
                </div>
              </div>
              <button
                onClick={isStreaming ? stopStreaming : (question.trim() ? handleStreamQuery : undefined)}
                disabled={!question.trim() && !isStreaming}
                className="w-12 h-12 bg-blue-600 text-white rounded-lg disabled:opacity-50 hover:bg-blue-700 transition-colors flex items-center justify-center"
              >
                {isStreaming ? <Square className="w-5 h-5" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}