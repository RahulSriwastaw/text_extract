import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#111111] p-3">
          <div className="max-w-md w-full bg-[#1A1A1A] rounded-[8px]  p-3 text-center border border-rose-100">
            <div className="w-16 h-16 bg-[#3A1A1A] text-[#F44336] rounded-[20px] flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-[20px] font-bold text-[#EFEFEF] mb-2">Something went wrong</h1>
            <p className="text-[#555555] mb-6 text-[13px]">
              An unexpected error occurred in the application.
            </p>
            <div className="bg-[#111111] rounded-[8px] p-3 text-left overflow-auto max-h-48 mb-6 border border-[#252525]">
              <p className="text-[11px] font-mono text-[#F44336] break-words">
                {this.state.error?.message || 'Unknown error'}
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-[#0F0F0F] text-white py-3 px-3 rounded-[8px] font-medium hover:bg-[#141414] transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
