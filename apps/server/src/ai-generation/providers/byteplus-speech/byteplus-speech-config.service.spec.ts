import { BytePlusSpeechConfigService } from './byteplus-speech-config.service';

describe('BytePlusSpeechConfigService', () => {
  const previousEnabled = process.env.BYTEPLUS_SEED_SPEECH_ENABLED;
  const previousKey = process.env.BYTEPLUS_SEED_SPEECH_API_KEY;

  afterEach(() => {
    setEnv('BYTEPLUS_SEED_SPEECH_ENABLED', previousEnabled);
    setEnv('BYTEPLUS_SEED_SPEECH_API_KEY', previousKey);
  });

  it('fails boot when enabled without the dedicated speech API key', () => {
    process.env.BYTEPLUS_SEED_SPEECH_ENABLED = 'true';
    delete process.env.BYTEPLUS_SEED_SPEECH_API_KEY;
    expect(() => new BytePlusSpeechConfigService()).toThrow(
      'requires BYTEPLUS_SEED_SPEECH_API_KEY',
    );
  });

  it('keeps the provider disabled without credentials by default', () => {
    delete process.env.BYTEPLUS_SEED_SPEECH_ENABLED;
    delete process.env.BYTEPLUS_SEED_SPEECH_API_KEY;
    expect(new BytePlusSpeechConfigService().config.enabled).toBe(false);
  });
});

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
