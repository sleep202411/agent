import { AiPromptCompilerService } from './prompt-compiler.service';

describe('AiPromptCompilerService', () => {
  it('keeps reference labels, snapshots, and provider image input in the same order', () => {
    const compiler = new AiPromptCompilerService();

    const result = compiler.compile({
      normalizedInput: { prompt: 'Test' },
      promptDocument: {
        version: 1,
        nodes: [
          { type: 'asset_ref', refId: 'ref-2', label: '参考图2' },
          { type: 'text', text: ' 在 ' },
          { type: 'asset_ref', refId: 'ref-1', label: '参考图1' },
          { type: 'text', text: ' 中快速奔跑' },
        ],
      },
      references: [
        { refId: 'ref-1', url: 'https://cdn.example.com/one.png' },
        { refId: 'ref-2', url: 'https://cdn.example.com/two.png' },
        { refId: 'ref-3', url: 'https://cdn.example.com/three.png' },
      ],
    });

    expect(result.snapshot.references.map((item) => item.token)).toEqual([
      '[Image 1]',
      '[Image 2]',
      '[Image 3]',
    ]);
    expect(result.snapshot.references.map((item) => item.url)).toEqual([
      'https://cdn.example.com/one.png',
      'https://cdn.example.com/two.png',
      'https://cdn.example.com/three.png',
    ]);
    expect(
      (result.normalizedInput.referenceImages as Array<{ url: string }>).map(
        (item) => item.url,
      ),
    ).toEqual([
      'https://cdn.example.com/one.png',
      'https://cdn.example.com/two.png',
      'https://cdn.example.com/three.png',
    ]);
    expect(result.snapshot.displayText).toBe('@参考图2 在 @参考图1 中快速奔跑');
    expect(result.snapshot.compiledPrompt).toContain(
      '[Image 2] 在 [Image 1] 中快速奔跑',
    );
    expect(result.snapshot.compiledPrompt).toContain(
      '[Image 1]: provided reference image 1\n[Image 2]: provided reference image 2\n[Image 3]: provided reference image 3',
    );
  });
});
