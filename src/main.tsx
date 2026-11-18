import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import VideoEditor from './VideoEditor';
import './styles.css';

const isSceneEditor = window.location.pathname === '/scene-editor';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isSceneEditor ? <App /> : <VideoEditor />}</React.StrictMode>,
);
