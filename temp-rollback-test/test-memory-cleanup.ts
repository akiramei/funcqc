
interface Item { SYNTAX_ERROR 
  kind: 'Tag';
  data: string;
}

function processItem(item: Item): string { SYNTAX_ERROR 
  if (item.kind === 'Tag') { SYNTAX_ERROR 
    return item.data;
  }
  return 'Unknown';
}

function isTag(item: Item): boolean { SYNTAX_ERROR 
  return item.kind === 'Tag';
}
