export class VoiceCommentSession {
  constructor({
    loadSettings,
    createProvider,
    createExternalPipeline,
    postComment,
    notifyActive,
    notifyError,
    startTimeoutMs = 10000,
    logger = console
  }) {
    this._loadSettings = loadSettings;
    this._createProvider = createProvider;
    this._createExternalPipeline = createExternalPipeline;
    this._postComment = postComment;
    this._notifyActive = notifyActive;
    this._notifyError = notifyError;
    this._startTimeoutMs = startTimeoutMs;
    this._logger = logger;

    this._isActive = false;
    this._isStarting = false;
    this._currentProvider = null;
    this._externalPipeline = null;
    this._startTimeoutId = null;
  }

  snapshot() {
    return { isActive: this._isActive };
  }

  toggle() {
    if (this._isActive) {
      this.stop();
      return this.snapshot();
    }

    if (this._isStarting) {
      return this.snapshot();
    }

    this._isStarting = true;
    this._startTimeoutId = setTimeout(() => {
      if (this._isStarting && !this._isActive) {
        this._handleStartTimeout();
      }
    }, this._startTimeoutMs);

    this._start().catch((error) => {
      this._logger.error('[Voice Live Comment] startRecognition failed:', error);
      this._notifyError('音声認識の開始に失敗しました: ' + error.message);
      this._finishStarting();
    });

    return this.snapshot();
  }

  async restartWithLatestSettings() {
    if (!this._isActive) return;

    await this.stop();
    this.toggle();
  }

  async stop() {
    this._isActive = false;
    this._finishStarting();

    const { provider, pipeline } = this._takeCurrentResources();

    await this._stopExternalPipeline(pipeline);
    await this._stopProvider(provider);

    this._notifyActive(false);
    this._logger.log('[Voice Live Comment] 音声認識を停止しました');
  }

  async _start() {
    const settings = await this._loadSettings();

    let provider;
    try {
      provider = this._createProvider(settings);
    } catch (error) {
      this._notifyError(error.message);
      this._finishStarting();
      return;
    }

    this._currentProvider = provider;
    this._bindProvider(provider);

    if (settings.sttProvider === 'google' || settings.sttProvider === 'grok') {
      try {
        this._externalPipeline = await this._createExternalPipeline(provider);
      } catch (error) {
        this._notifyError('VADの初期化に失敗しました: ' + error.message);
        this._currentProvider = null;
        this._finishStarting();
        return;
      }
    }

    try {
      await provider.start();
    } catch (error) {
      await this._cleanupFailedStart();
      this._notifyError(error.message);
    }
  }

  _bindProvider(provider) {
    provider.onStart(() => {
      this._isActive = true;
      this._finishStarting();
      this._notifyActive(true);
      this._logger.log('[Voice Live Comment] 音声認識を開始しました');
    });

    provider.onResult((text) => {
      this._postComment(text);
    });

    provider.onError((error) => {
      this._notifyError(error.message);
      if (this._isStarting) {
        this._finishStarting();
      }
    });
  }

  async _cleanupFailedStart() {
    const { pipeline } = this._takeCurrentResources();

    await this._stopExternalPipeline(pipeline);
    this._isActive = false;
    this._finishStarting();
  }

  async _handleStartTimeout() {
    this._logger.warn('[Voice Live Comment] 音声認識の開始がタイムアウトしました');

    const { provider, pipeline } = this._takeCurrentResources();

    await this._stopExternalPipeline(pipeline);
    await this._stopProvider(provider);

    this._finishStarting();
    this._notifyError('音声認識の開始がタイムアウトしました。再度お試しください。');
  }

  _takeCurrentResources() {
    const provider = this._currentProvider;
    const pipeline = this._externalPipeline;
    this._currentProvider = null;
    this._externalPipeline = null;
    return { provider, pipeline };
  }

  async _stopProvider(providerToStop) {
    if (providerToStop) {
      try { await providerToStop.stop(); } catch (_) {}
    }
  }

  async _stopExternalPipeline(pipelineToStop) {
    if (pipelineToStop) {
      try { await pipelineToStop.stop(); } catch (_) {}
    }
  }

  _finishStarting() {
    this._isStarting = false;
    this._clearStartTimeout();
  }

  _clearStartTimeout() {
    clearTimeout(this._startTimeoutId);
    this._startTimeoutId = null;
  }
}
