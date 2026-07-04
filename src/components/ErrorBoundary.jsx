import React from 'react';

export class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("System Crash:", error, info); }
  render() {
    if (this.state.hasError) return <div style={{color: 'red'}}>System Error: {this.state.error.message}</div>;
    return this.props.children;
  }
}
