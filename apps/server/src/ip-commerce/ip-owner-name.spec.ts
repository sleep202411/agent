import { resolveIpOwnerName } from './ip-commerce.service';

type Contributor = {
  userId: string | null;
  displayName: string;
  isPublic: boolean;
};

function title(input: {
  copyrightOwner?: string | null;
  createdById?: string;
  contributors?: Contributor[];
}) {
  return {
    copyrightOwner: input.copyrightOwner ?? null,
    createdById: input.createdById ?? '',
    contributors: input.contributors ?? [],
  };
}

it('prefers the authored copyright line whenever it has content', () => {
  expect(
    resolveIpOwnerName(
      title({
        copyrightOwner: '  FizzDragon Studio  ',
        createdById: '42',
        contributors: [{ userId: '42', displayName: 'Rin', isPublic: true }],
      }),
    ),
  ).toBe('FizzDragon Studio');
});

it('falls back to the creator public contributor credit', () => {
  expect(
    resolveIpOwnerName(
      title({
        createdById: '42',
        contributors: [
          { userId: '7', displayName: 'Someone Else', isPublic: true },
          { userId: '42', displayName: 'Rin', isPublic: true },
        ],
      }),
    ),
  ).toBe('Rin');
});

it('never leaks a private creator credit', () => {
  expect(
    resolveIpOwnerName(
      title({
        createdById: '42',
        contributors: [
          { userId: '42', displayName: 'Rin', isPublic: false },
          { userId: '7', displayName: 'Public Member', isPublic: true },
        ],
      }),
    ),
  ).toBeNull();
});

it('returns null when the creator has no credit row at all', () => {
  expect(
    resolveIpOwnerName(
      title({
        createdById: '42',
        contributors: [
          { userId: '7', displayName: 'Public Member', isPublic: true },
        ],
      }),
    ),
  ).toBeNull();
});

it('returns null for blank copyright text and no creator id', () => {
  expect(resolveIpOwnerName(title({ copyrightOwner: '   ' }))).toBeNull();
  expect(resolveIpOwnerName(title({ createdById: '42' }))).toBeNull();
  expect(resolveIpOwnerName(title({}))).toBeNull();
});

it('trims and rejects whitespace-only creator credits', () => {
  expect(
    resolveIpOwnerName(
      title({
        createdById: '42',
        contributors: [{ userId: '42', displayName: '   ', isPublic: true }],
      }),
    ),
  ).toBeNull();
  expect(
    resolveIpOwnerName(
      title({
        createdById: '42',
        contributors: [
          { userId: '42', displayName: '  Rin  ', isPublic: true },
        ],
      }),
    ),
  ).toBe('Rin');
});
