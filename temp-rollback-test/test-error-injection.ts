
interface Item {
  kind: 'Tag' | 'Note';
  data: string;
}

function test1(item: Item): boolean {
  return item.kind === 'Tag';
}

function test2(item: Item): boolean {
  return item.kind === 'Note';
}

function isTag(item: Item): boolean {
  return item.kind === 'Tag';
}

function isNote(item: Item): boolean {
  return item.kind === 'Note';
}
