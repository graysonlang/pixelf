export function firstImageFile(files: Iterable<File>): File | null {
  for (const file of files) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

export function isFileDrag(types: Iterable<string>): boolean {
  return [...types].includes('Files');
}
