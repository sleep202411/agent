import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  taskDeliveryFolderTx,
  publishTaskDeliveryAssetsTx,
} from './task-delivery-folder';
const task = { id: 'task', crewId: 'crew', title: 'Final cut' };
function fixture() {
  const tx = {
    $executeRaw: jest
      .fn<Promise<number>, [TemplateStringsArray, ...unknown[]]>()
      .mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    crewAssetNode: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
      create: jest.fn().mockResolvedValue({ id: 'created' }),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const access = {
    requireContainerPermission: jest.fn().mockResolvedValue(undefined),
    requireNodesPermission: jest.fn().mockResolvedValue(undefined),
  };
  return {
    tx,
    access,
    prepare: (id?: string) =>
      taskDeliveryFolderTx(tx as never, access as never, task, 'actor', id),
    publish: () =>
      publishTaskDeliveryAssetsTx(tx as never, access as never, task, 'actor', [
        'asset',
      ]),
  };
}
it('creates a named folder once and reuses the task mapping on subsequent submissions', async () => {
  const f = fixture();
  expect(await f.prepare()).toBe('created');
  expect(f.tx.crewAssetNode.create).toHaveBeenCalledWith({
    data: {
      crewId: 'crew',
      kind: 'folder',
      parentId: null,
      name: 'Final cut',
      createdByUserId: 'actor',
      updatedByUserId: 'actor',
    },
  });
  f.tx.$queryRaw.mockResolvedValue([{ folderId: 'existing' }]);
  expect(await f.prepare()).toBe('existing');
  expect(f.tx.crewAssetNode.create).toHaveBeenCalledTimes(1);
  expect(f.tx.crewAssetNode.updateMany).not.toHaveBeenCalled();
});
it('validates the selected folder in the same Crew and rejects unavailable folders', async () => {
  const f = fixture();
  f.tx.crewAssetNode.findFirst.mockResolvedValue(null);
  await expect(f.prepare('foreign')).rejects.toBeInstanceOf(
    BadRequestException,
  );
  expect(f.tx.crewAssetNode.findFirst).toHaveBeenCalledWith({
    where: { id: 'foreign', crewId: 'crew', kind: 'folder', status: 'active' },
  });
  expect(f.tx.crewAssetNode.create).not.toHaveBeenCalled();
});
it('requires destination upload permission before creating or linking a folder', async () => {
  const f = fixture();
  f.access.requireContainerPermission.mockRejectedValue(
    new ForbiddenException(),
  );
  await expect(f.prepare()).rejects.toBeInstanceOf(ForbiddenException);
  expect(f.tx.crewAssetNode.create).not.toHaveBeenCalled();
});
it('requires source view permission before publishing accepted files', async () => {
  const f = fixture();
  f.access.requireNodesPermission.mockRejectedValue(new ForbiddenException());
  await expect(f.publish()).rejects.toBeInstanceOf(ForbiddenException);
  expect(f.tx.crewAssetNode.updateMany).not.toHaveBeenCalled();
});
it('records accepted references without moving files or altering their permissions', async () => {
  const f = fixture();
  await f.publish();
  expect(f.tx.crewAssetNode.updateMany).not.toHaveBeenCalled();
  expect(
    f.tx.$executeRaw.mock.calls.some((call) =>
      String(call[0]).includes('INSERT INTO crew_task_delivery_assets'),
    ),
  ).toBe(true);
  f.tx.crewAssetNode.count.mockResolvedValue(0);
  await expect(f.publish()).rejects.toBeInstanceOf(BadRequestException);
});

it('allocates a distinct folder when another task already uses the same title', async () => {
  const f = fixture();
  f.tx.crewAssetNode.findMany.mockResolvedValue([{ name: 'Final cut' }]);
  await f.prepare();
  expect(f.tx.crewAssetNode.create).toHaveBeenCalledWith({
    data: {
      crewId: 'crew',
      kind: 'folder',
      parentId: null,
      name: 'Final cut (2)',
      createdByUserId: 'actor',
      updatedByUserId: 'actor',
    },
  });
});

it('places a script task under its stable category folder even when renamed', async () => {
  const f = fixture();
  f.tx.crewAssetNode.findFirst.mockResolvedValue({
    id: 'renamed-script',
    status: 'active',
  });
  await taskDeliveryFolderTx(
    f.tx as never,
    f.access as never,
    { ...task, taskKind: 'script' },
    'actor',
  );
  expect(f.tx.crewAssetNode.findFirst).toHaveBeenCalledWith({
    where: { crewId: 'crew', folderKey: 'script', kind: 'folder' },
    select: { id: true, status: true },
  });
  expect(f.tx.crewAssetNode.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      parentId: 'renamed-script',
      name: 'Final cut',
    }) as unknown,
  });
  expect(f.access.requireContainerPermission).toHaveBeenCalledWith(
    'crew',
    'renamed-script',
    'actor',
    'upload',
    f.tx,
  );
});
it('does not route around a trashed or restricted category folder', async () => {
  const f = fixture();
  f.tx.crewAssetNode.findFirst.mockResolvedValue({
    id: 'script',
    status: 'trashed',
  });
  await expect(
    taskDeliveryFolderTx(
      f.tx as never,
      f.access as never,
      { ...task, taskKind: 'script' },
      'actor',
    ),
  ).rejects.toThrow('category folder is unavailable');
  f.tx.crewAssetNode.findFirst.mockResolvedValue({
    id: 'script',
    status: 'active',
  });
  f.access.requireContainerPermission.mockRejectedValue(
    new ForbiddenException(),
  );
  await expect(
    taskDeliveryFolderTx(
      f.tx as never,
      f.access as never,
      { ...task, taskKind: 'script' },
      'actor',
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(f.tx.crewAssetNode.create).not.toHaveBeenCalled();
});
it('keeps a previously selected task folder when its task type changes', async () => {
  const f = fixture();
  f.tx.$queryRaw.mockResolvedValue([{ folderId: 'existing' }]);
  await taskDeliveryFolderTx(
    f.tx as never,
    f.access as never,
    { ...task, taskKind: 'script' },
    'actor',
  );
  expect(f.tx.crewAssetNode.findFirst).toHaveBeenCalledWith({
    where: { id: 'existing', crewId: 'crew', kind: 'folder', status: 'active' },
  });
  expect(f.tx.crewAssetNode.create).not.toHaveBeenCalled();
});
