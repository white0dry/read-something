import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { Chapter, ReaderContentBlock } from '../types';
import { deleteImageByRef, saveImageBlob } from './imageStorage';

type SupportedImportFormat = 'txt' | 'word' | 'epub' | 'pdf';

export interface ParsedBookImportResult {
  format: SupportedImportFormat;
  title: string;
  author: string;
  coverUrl: string;
  fullText: string;
  chapters: Chapter[];
  generatedImageRefs: string[];
}

const WORD_SUFFIXES = new Set(['docx', 'docm', 'dotx', 'dotm']);
const EPUB_SUFFIXES = new Set(['epub']);
const PDF_SUFFIXES = new Set(['pdf']);
const TXT_SUFFIXES = new Set(['txt']);
const SUPPORTED_SUFFIXES = [...TXT_SUFFIXES, ...WORD_SUFFIXES, ...PDF_SUFFIXES, ...EPUB_SUFFIXES];

export const BOOK_IMPORT_ACCEPT = SUPPORTED_SUFFIXES.map((suffix) => `.${suffix}`).join(',');
export const SUPPORTED_BOOK_IMPORT_SUFFIXES = [...SUPPORTED_SUFFIXES];

const UTF8_DECODER = new TextDecoder('utf-8');
const BLOCK_TAGS = new Set([
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

let pdfWorkerConfigured = false;

interface ImportParseContext {
  generatedImageRefs: string[];
}

interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
  fullPath: string;
}

interface EpubTocEntry {
  title: string;
  fullPath: string;
  fragmentId: string;
}

interface EpubTokenizedDocument {
  title: string;
  tokens: HtmlToken[];
  anchorIndexMap: Map<string, number>;
}

interface HtmlTokenText {
  type: 'text';
  text: string;
}

interface HtmlTokenBreak {
  type: 'break';
}

interface HtmlTokenImage {
  type: 'image';
  src: string;
  alt?: string;
  title?: string;
}

interface HtmlTokenAnchor {
  type: 'anchor';
  id: string;
}

type HtmlToken = HtmlTokenText | HtmlTokenBreak | HtmlTokenImage | HtmlTokenAnchor;

const trimFileExt = (name: string) => {
  const trimmed = name.trim();
  return trimmed.replace(/\.[^./\\]+$/, '').trim() || 'Untitled';
};

const getFileSuffix = (name: string) => {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
};

const compactWhitespace = (value: string) => value.replace(/[ \t\u00A0]+/g, ' ').trim();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeTextBlock = (raw: string) => {
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return normalized.trim();
};

const mergeAdjacentTextBlocks = (blocks: ReaderContentBlock[]) => {
  const merged: ReaderContentBlock[] = [];
  blocks.forEach((block) => {
    if (block.type !== 'text') {
      merged.push(block);
      return;
    }
    const text = normalizeTextBlock(block.text);
    if (!text) return;
    const last = merged[merged.length - 1];
    if (last && last.type === 'text') {
      last.text = normalizeTextBlock(`${last.text}\n${text}`);
      return;
    }
    merged.push({ type: 'text', text });
  });
  return merged;
};

const buildChapterFromBlocks = (title: string, blocks: ReaderContentBlock[]): Chapter => {
  const normalizedBlocks = mergeAdjacentTextBlocks(blocks);
  const content = normalizeTextBlock(
    normalizedBlocks
      .filter((block): block is Extract<ReaderContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  );
  return {
    title: compactWhitespace(title) || '全文',
    content,
    ...(normalizedBlocks.length > 0 ? { blocks: normalizedBlocks } : {}),
  };
};

const buildFallbackSingleChapter = (title: string, fullText: string): Chapter[] => [
  {
    title: compactWhitespace(title) || '全文',
    content: fullText,
    blocks: fullText ? [{ type: 'text', text: fullText }] : [],
  },
];

const readXmlDocument = (xmlText: string) => {
  const parser = new DOMParser();
  return parser.parseFromString(xmlText, 'application/xml');
};

const findXmlTextByLocalName = (doc: Document, localName: string) => {
  const nodes = Array.from(doc.getElementsByTagName('*'));
  const matched = nodes.find((node) => {
    if (!node.localName || node.localName.toLowerCase() !== localName.toLowerCase()) return false;
    return Boolean(node.textContent && node.textContent.trim());
  });
  return matched?.textContent?.trim() || '';
};

const findFirstHeadingText = (doc: Document) => {
  const heading = doc.querySelector('h1, h2, h3');
  return compactWhitespace(heading?.textContent || '');
};

const normalizeZipPath = (value: string) => value.replace(/\\/g, '/').replace(/^\//, '').replace(/^\.\//, '');

const resolveZipRelativePath = (baseFilePath: string, targetPath: string) => {
  const sanitizedTarget = targetPath.split('#')[0].split('?')[0].trim();
  if (!sanitizedTarget) return '';
  if (/^[a-z]+:/i.test(sanitizedTarget)) return sanitizedTarget;
  const base = normalizeZipPath(baseFilePath);
  const baseDir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  try {
    const resolved = new URL(sanitizedTarget, `https://reader.local/${baseDir}`).pathname.replace(/^\//, '');
    return normalizeZipPath(decodeURIComponent(resolved));
  } catch {
    return normalizeZipPath(`${baseDir}${sanitizedTarget}`);
  }
};

const isHtmlLikeMediaType = (mediaType: string) => /xhtml|html/i.test(mediaType);

const safeDecodeUriComponent = (value: string) => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeAnchorId = (value: string) => safeDecodeUriComponent(value).trim();

const resolveEpubHrefTarget = (baseFilePath: string, href: string) => {
  const trimmedHref = href.trim();
  if (!trimmedHref) return null;
  if (/^[a-z]+:/i.test(trimmedHref)) return null;

  const [pathWithQuery = '', fragmentPart = ''] = trimmedHref.split('#', 2);
  const path = pathWithQuery.split('?')[0].trim();
  const fullPath = path ? resolveZipRelativePath(baseFilePath, path) : normalizeZipPath(baseFilePath);
  if (!fullPath || /^[a-z]+:/i.test(fullPath)) return null;

  return {
    fullPath,
    fragmentId: normalizeAnchorId(fragmentPart),
  };
};

const dedupeEpubTocEntries = (entries: EpubTocEntry[]) => {
  const deduped: EpubTocEntry[] = [];
  const seenTargets = new Set<string>();
  entries.forEach((entry) => {
    const targetKey = `${entry.fullPath}#${entry.fragmentId}`;
    if (seenTargets.has(targetKey)) return;
    seenTargets.add(targetKey);
    deduped.push(entry);
  });
  return deduped;
};

const parseEpubNavTocEntries = async (zip: JSZip, navFilePath: string) => {
  const navEntry = zip.file(navFilePath);
  if (!navEntry) return [] as EpubTocEntry[];

  const navText = await navEntry.async('string');
  const navDoc = new DOMParser().parseFromString(navText, 'text/html');
  const navNodes = Array.from(navDoc.querySelectorAll('nav'));
  const tocNav =
    navNodes.find((node) => {
      const epubType = (node.getAttribute('epub:type') || '').toLowerCase();
      const type = (node.getAttribute('type') || '').toLowerCase();
      const role = (node.getAttribute('role') || '').toLowerCase();
      return epubType.includes('toc') || type.includes('toc') || role.includes('doc-toc');
    }) ||
    navNodes[0] ||
    navDoc.body;

  if (!tocNav) return [] as EpubTocEntry[];

  return Array.from(tocNav.querySelectorAll('a[href]'))
    .map((anchor) => {
      const href = anchor.getAttribute('href') || '';
      const target = resolveEpubHrefTarget(navFilePath, href);
      if (!target) return null;
      const title = compactWhitespace(anchor.textContent || '');
      if (!title) return null;
      return {
        title,
        fullPath: target.fullPath,
        fragmentId: target.fragmentId,
      } satisfies EpubTocEntry;
    })
    .filter((entry): entry is EpubTocEntry => Boolean(entry));
};

const parseEpubNcxTocEntries = async (zip: JSZip, ncxFilePath: string) => {
  const ncxEntry = zip.file(ncxFilePath);
  if (!ncxEntry) return [] as EpubTocEntry[];

  const ncxText = await ncxEntry.async('string');
  const ncxDoc = readXmlDocument(ncxText);
  const navPoints = Array.from(ncxDoc.getElementsByTagName('*')).filter(
    (node) => (node.localName || '').toLowerCase() === 'navpoint'
  );

  return navPoints
    .map((navPoint) => {
      const titleNode = Array.from(navPoint.getElementsByTagName('*')).find(
        (node) => (node.localName || '').toLowerCase() === 'text'
      );
      const contentNode = Array.from(navPoint.getElementsByTagName('*')).find(
        (node) => (node.localName || '').toLowerCase() === 'content'
      );
      const src = contentNode?.getAttribute('src') || '';
      const target = resolveEpubHrefTarget(ncxFilePath, src);
      if (!target) return null;
      const title = compactWhitespace(titleNode?.textContent || '');
      if (!title) return null;
      return {
        title,
        fullPath: target.fullPath,
        fragmentId: target.fragmentId,
      } satisfies EpubTocEntry;
    })
    .filter((entry): entry is EpubTocEntry => Boolean(entry));
};

const loadEpubTocEntries = async (params: {
  zip: JSZip;
  manifest: Map<string, EpubManifestItem>;
  opfDoc: Document;
}) => {
  const { zip, manifest, opfDoc } = params;
  const manifestItems = Array.from(manifest.values());
  const navItem = manifestItems.find((item) => item.properties.includes('nav') && isHtmlLikeMediaType(item.mediaType));

  const spineNode = Array.from(opfDoc.getElementsByTagName('*')).find((node) => node.localName === 'spine');
  const spineTocId = (spineNode?.getAttribute('toc') || '').trim();
  const ncxItem =
    (spineTocId ? manifest.get(spineTocId) : undefined) ||
    manifestItems.find((item) => /application\/x-dtbncx\+xml/i.test(item.mediaType));

  const navEntries = navItem ? await parseEpubNavTocEntries(zip, navItem.fullPath) : [];
  if (navEntries.length > 0) {
    return dedupeEpubTocEntries(navEntries);
  }

  const ncxEntries = ncxItem ? await parseEpubNcxTocEntries(zip, ncxItem.fullPath) : [];
  return dedupeEpubTocEntries(ncxEntries);
};

const collectHtmlTokens = (node: Node, tokens: HtmlToken[]) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    if (text) tokens.push({ type: 'text', text });
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  const anchorIds = [element.getAttribute('id'), element.getAttribute('name')]
    .map((value) => (value || '').trim())
    .filter(Boolean);
  if (anchorIds.length > 0) {
    const seen = new Set<string>();
    anchorIds.forEach((anchorId) => {
      if (seen.has(anchorId)) return;
      seen.add(anchorId);
      tokens.push({ type: 'anchor', id: anchorId });
    });
  }

  if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') return;
  if (tagName === 'img') {
    const src = element.getAttribute('src') || '';
    if (src.trim()) {
      tokens.push({
        type: 'image',
        src: src.trim(),
        alt: element.getAttribute('alt') || undefined,
        title: element.getAttribute('title') || undefined,
      });
    }
    return;
  }
  if (tagName === 'br') {
    tokens.push({ type: 'break' });
    return;
  }

  const isBlock = BLOCK_TAGS.has(tagName);
  if (isBlock) tokens.push({ type: 'break' });
  Array.from(element.childNodes).forEach((child) => collectHtmlTokens(child, tokens));
  if (isBlock) tokens.push({ type: 'break' });
};

const isCanvasLike = (value: unknown): value is HTMLCanvasElement =>
  typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement;

const isImageLike = (value: unknown): value is HTMLImageElement =>
  typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement;

const isImageBitmapLike = (value: unknown): value is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;

const canvasToBlob = async (canvas: HTMLCanvasElement, type = 'image/png', quality?: number) => {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
};

const collectImageRef = async (blob: Blob, context: ImportParseContext) => {
  const imageRef = await saveImageBlob(blob);
  context.generatedImageRefs.push(imageRef);
  return imageRef;
};

const materializeHtmlTokens = async (
  tokens: HtmlToken[],
  resolveImage: (token: HtmlTokenImage) => Promise<string | null>
) => {
  const blocks: ReaderContentBlock[] = [];
  let textBuffer = '';

  const flushText = () => {
    const text = normalizeTextBlock(textBuffer);
    textBuffer = '';
    if (!text) return;
    blocks.push({ type: 'text', text });
  };

  for (const token of tokens) {
    if (token.type === 'text') {
      textBuffer += token.text;
      continue;
    }
    if (token.type === 'break') {
      textBuffer += '\n';
      continue;
    }
    if (token.type === 'anchor') {
      continue;
    }

    flushText();
    const imageRef = await resolveImage(token);
    if (!imageRef) continue;
    blocks.push({
      type: 'image',
      imageRef,
      alt: token.alt,
      title: token.title,
    });
  }

  flushText();
  return mergeAdjacentTextBlocks(blocks);
};

const deleteGeneratedImages = async (imageRefs: string[]) => {
  if (imageRefs.length === 0) return;
  await Promise.all(imageRefs.map((imageRef) => deleteImageByRef(imageRef).catch(() => undefined)));
};

const ensurePdfWorker = () => {
  if (pdfWorkerConfigured) return;
  (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  pdfWorkerConfigured = true;
};

const parseTxtFile = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const fullText = normalizeTextBlock(UTF8_DECODER.decode(buffer));
  const title = trimFileExt(file.name);
  return {
    format: 'txt' as const,
    title,
    author: '佚名',
    coverUrl: '',
    fullText,
    chapters: buildFallbackSingleChapter('全文', fullText),
  };
};

const parseWordMetadata = async (zip: JSZip) => {
  const coreEntry = zip.file('docProps/core.xml');
  if (!coreEntry) {
    return { title: '', author: '' };
  }
  const xml = await coreEntry.async('string');
  const doc = readXmlDocument(xml);
  return {
    title: findXmlTextByLocalName(doc, 'title'),
    author: findXmlTextByLocalName(doc, 'creator'),
  };
};

const resolveDataImageToken = async (token: HtmlTokenImage, context: ImportParseContext) => {
  const src = token.src.trim();
  if (!src || !src.startsWith('data:image/')) return null;
  const response = await fetch(src);
  if (!response.ok) return null;
  const blob = await response.blob();
  return collectImageRef(blob, context);
};

const parseWordFile = async (file: File, context: ImportParseContext) => {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const metadata = await parseWordMetadata(zip);
  const thumbnailEntry =
    zip.file(/^docProps\/thumbnail\.(png|jpe?g|webp|bmp)$/i)?.[0] ||
    zip.file(/^docProps\/thumb\.(png|jpe?g|webp|bmp)$/i)?.[0];
  let coverUrl = '';
  if (thumbnailEntry) {
    const blob = await thumbnailEntry.async('blob');
    coverUrl = await collectImageRef(blob, context);
  }

  const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
  const htmlDoc = new DOMParser().parseFromString(htmlResult.value || '', 'text/html');
  const rawTextResult = await mammoth.extractRawText({ arrayBuffer });
  const fallbackText = normalizeTextBlock(rawTextResult.value || '');

  const chapters: Chapter[] = [];
  let chapterTitle = '';
  let chapterIndex = 1;
  let chapterTokens: HtmlToken[] = [];

  const flushChapter = async () => {
    const blocks = await materializeHtmlTokens(chapterTokens, (token) => resolveDataImageToken(token, context));
    chapterTokens = [];
    if (blocks.length === 0) return;
    const chapter = buildChapterFromBlocks(chapterTitle || `第 ${chapterIndex} 章`, blocks);
    if (!chapter.content && (!chapter.blocks || chapter.blocks.length === 0)) return;
    chapters.push(chapter);
    chapterIndex += 1;
  };

  for (const node of Array.from(htmlDoc.body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = (node as HTMLElement).tagName.toLowerCase();
      if (/^h[1-6]$/.test(tagName)) {
        await flushChapter();
        chapterTitle = compactWhitespace(node.textContent || '') || `第 ${chapterIndex} 章`;
        continue;
      }
    }
    collectHtmlTokens(node, chapterTokens);
  }

  await flushChapter();

  const fullText = normalizeTextBlock(
    chapters.length > 0
      ? chapters.map((chapter) => chapter.content).filter(Boolean).join('\n\n')
      : fallbackText
  );

  const resolvedTitle = metadata.title || findFirstHeadingText(htmlDoc) || trimFileExt(file.name);
  const resolvedAuthor = metadata.author || '佚名';
  return {
    format: 'word' as const,
    title: compactWhitespace(resolvedTitle) || trimFileExt(file.name),
    author: compactWhitespace(resolvedAuthor) || '佚名',
    coverUrl,
    fullText,
    chapters: chapters.length > 0 ? chapters : buildFallbackSingleChapter('全文', fullText),
  };
};

const getEpubPackagePath = async (zip: JSZip) => {
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) return '';
  const containerText = await containerEntry.async('string');
  const containerDoc = readXmlDocument(containerText);
  const rootfile = Array.from(containerDoc.getElementsByTagName('*')).find((node) => node.localName === 'rootfile');
  const fullPath = rootfile?.getAttribute('full-path') || '';
  return normalizeZipPath(fullPath);
};

const parseEpubFile = async (file: File, context: ImportParseContext) => {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const packagePath = await getEpubPackagePath(zip);
  if (!packagePath) {
    throw new Error('EPUB package metadata not found.');
  }
  const opfEntry = zip.file(packagePath);
  if (!opfEntry) {
    throw new Error('EPUB package file is missing.');
  }

  const opfText = await opfEntry.async('string');
  const opfDoc = readXmlDocument(opfText);
  const opfDir = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';

  const manifest = new Map<string, EpubManifestItem>();

  Array.from(opfDoc.getElementsByTagName('*'))
    .filter((node) => node.localName === 'item')
    .forEach((node) => {
      const id = node.getAttribute('id') || '';
      const href = node.getAttribute('href') || '';
      const mediaType = node.getAttribute('media-type') || '';
      const properties = (node.getAttribute('properties') || '')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!id || !href) return;
      manifest.set(id, {
        id,
        href,
        mediaType,
        properties,
        fullPath: normalizeZipPath(resolveZipRelativePath(`${opfDir}index.opf`, href)),
      });
    });

  const coverIdFromMeta = Array.from(opfDoc.getElementsByTagName('*'))
    .filter((node) => node.localName === 'meta')
    .find((node) => (node.getAttribute('name') || '').toLowerCase() === 'cover')
    ?.getAttribute('content') || '';
  const coverItem =
    Array.from(manifest.values()).find((item) => item.properties.includes('cover-image')) ||
    (coverIdFromMeta ? manifest.get(coverIdFromMeta) : undefined);
  let coverUrl = '';
  if (coverItem) {
    const coverEntry = zip.file(coverItem.fullPath);
    if (coverEntry) {
      const blob = await coverEntry.async('blob');
      coverUrl = await collectImageRef(blob, context);
    }
  }

  const spineIds = Array.from(opfDoc.getElementsByTagName('*'))
    .filter((node) => node.localName === 'itemref')
    .map((node) => (node.getAttribute('idref') || '').trim())
    .filter(Boolean);

  const resolveEpubImageToken = async (token: HtmlTokenImage, baseFilePath: string) => {
    const src = token.src.trim();
    if (!src) return null;
    if (src.startsWith('data:image/')) {
      const response = await fetch(src);
      if (!response.ok) return null;
      const blob = await response.blob();
      return collectImageRef(blob, context);
    }
    if (/^[a-z]+:/i.test(src)) return null;
    const resolvedPath = resolveZipRelativePath(baseFilePath, src);
    const imageEntry = zip.file(resolvedPath);
    if (!imageEntry) return null;
    const blob = await imageEntry.async('blob');
    return collectImageRef(blob, context);
  };

  const tocEntries = await loadEpubTocEntries({ zip, manifest, opfDoc });
  const spineManifestItems = spineIds
    .map((id) => manifest.get(id))
    .filter((item): item is EpubManifestItem => Boolean(item) && isHtmlLikeMediaType(item.mediaType));
  const spineManifestByPath = new Map<string, EpubManifestItem>();
  spineManifestItems.forEach((item) => {
    if (!spineManifestByPath.has(item.fullPath)) {
      spineManifestByPath.set(item.fullPath, item);
    }
  });

  const tocEntriesInSpine = tocEntries.filter((entry) => spineManifestByPath.has(entry.fullPath));
  const spineIndexByPath = new Map<string, number>();
  spineManifestItems.forEach((item, index) => {
    if (!spineIndexByPath.has(item.fullPath)) {
      spineIndexByPath.set(item.fullPath, index);
    }
  });
  const tokenizedDocumentCache = new Map<string, EpubTokenizedDocument | null>();
  const getTokenizedDocument = async (manifestItem: EpubManifestItem) => {
    if (tokenizedDocumentCache.has(manifestItem.fullPath)) {
      return tokenizedDocumentCache.get(manifestItem.fullPath) || null;
    }

    const chapterEntry = zip.file(manifestItem.fullPath);
    if (!chapterEntry) {
      tokenizedDocumentCache.set(manifestItem.fullPath, null);
      return null;
    }

    const htmlText = await chapterEntry.async('string');
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const tokens: HtmlToken[] = [];
    Array.from(doc.body.childNodes).forEach((node) => collectHtmlTokens(node, tokens));
    const anchorIndexMap = new Map<string, number>();
    tokens.forEach((token, tokenIndex) => {
      if (token.type !== 'anchor') return;
      const anchorId = normalizeAnchorId(token.id);
      if (!anchorId || anchorIndexMap.has(anchorId)) return;
      anchorIndexMap.set(anchorId, tokenIndex);
    });
    const tokenized: EpubTokenizedDocument = {
      title: findFirstHeadingText(doc) || compactWhitespace(doc.querySelector('title')?.textContent || ''),
      tokens,
      anchorIndexMap,
    };
    tokenizedDocumentCache.set(manifestItem.fullPath, tokenized);
    return tokenized;
  };

  const chapters: Chapter[] = [];

  if (tocEntriesInSpine.length > 0) {
    for (let index = 0; index < tocEntriesInSpine.length; index += 1) {
      const tocEntry = tocEntriesInSpine[index];
      const startSpineIndex = spineIndexByPath.get(tocEntry.fullPath);
      if (typeof startSpineIndex !== 'number') continue;

      const startManifestItem = spineManifestItems[startSpineIndex];
      if (!startManifestItem) continue;
      const startDoc = await getTokenizedDocument(startManifestItem);
      if (!startDoc) continue;

      let startTokenIndex = 0;
      if (tocEntry.fragmentId) {
        const mappedStart = startDoc.anchorIndexMap.get(tocEntry.fragmentId);
        if (typeof mappedStart === 'number') {
          startTokenIndex = mappedStart;
        }
      }

      const nextTocEntry = tocEntriesInSpine[index + 1];
      let endSpineIndex = spineManifestItems.length;
      let endTokenIndex = 0;

      if (nextTocEntry) {
        const mappedEndSpineIndex = spineIndexByPath.get(nextTocEntry.fullPath);
        if (typeof mappedEndSpineIndex === 'number') {
          if (mappedEndSpineIndex < startSpineIndex) continue;
          endSpineIndex = mappedEndSpineIndex;

          if (nextTocEntry.fragmentId) {
            const endManifestItem = spineManifestItems[mappedEndSpineIndex];
            const endDoc = endManifestItem ? await getTokenizedDocument(endManifestItem) : null;
            const mappedEnd = endDoc?.anchorIndexMap.get(nextTocEntry.fragmentId);
            if (typeof mappedEnd === 'number' && mappedEnd >= 0) {
              endTokenIndex = mappedEnd;
            }
          }
        }
      }

      const blocks: ReaderContentBlock[] = [];
      if (endSpineIndex === startSpineIndex) {
        const sameFileEnd = endTokenIndex > startTokenIndex ? endTokenIndex : startDoc.tokens.length;
        if (sameFileEnd > startTokenIndex) {
          const chapterTokens = startDoc.tokens.slice(startTokenIndex, sameFileEnd);
          const chapterBlocks = await materializeHtmlTokens(chapterTokens, (token) =>
            resolveEpubImageToken(token, startManifestItem.fullPath)
          );
          if (chapterBlocks.length > 0) {
            blocks.push(...chapterBlocks);
          }
        }
      } else {
        const shouldIncludeEndPartial = endSpineIndex < spineManifestItems.length && endTokenIndex > 0;
        const finalSpineIndex = shouldIncludeEndPartial ? endSpineIndex : Math.min(endSpineIndex, spineManifestItems.length) - 1;

        for (let spineIndex = startSpineIndex; spineIndex <= finalSpineIndex; spineIndex += 1) {
          const manifestItem = spineManifestItems[spineIndex];
          if (!manifestItem) continue;
          const tokenized = spineIndex === startSpineIndex ? startDoc : await getTokenizedDocument(manifestItem);
          if (!tokenized) continue;

          const segmentStart = spineIndex === startSpineIndex ? startTokenIndex : 0;
          const segmentEnd =
            spineIndex === endSpineIndex && shouldIncludeEndPartial
              ? clamp(endTokenIndex, 0, tokenized.tokens.length)
              : tokenized.tokens.length;
          if (segmentEnd <= segmentStart) continue;

          const segmentTokens = tokenized.tokens.slice(segmentStart, segmentEnd);
          if (segmentTokens.length === 0) continue;
          const segmentBlocks = await materializeHtmlTokens(segmentTokens, (token) =>
            resolveEpubImageToken(token, manifestItem.fullPath)
          );
          if (segmentBlocks.length > 0) {
            blocks.push(...segmentBlocks);
          }
        }
      }

      if (blocks.length === 0) continue;
      const chapterTitle = tocEntry.title || startDoc.title || `Chapter ${chapters.length + 1}`;
      const chapter = buildChapterFromBlocks(chapterTitle, blocks);
      if (!chapter.content && (!chapter.blocks || chapter.blocks.length === 0)) continue;
      chapters.push(chapter);
    }
  }

  if (chapters.length === 0) {
    for (let index = 0; index < spineManifestItems.length; index += 1) {
      const manifestItem = spineManifestItems[index];
      const tokenized = await getTokenizedDocument(manifestItem);
      if (!tokenized) continue;
      const blocks = await materializeHtmlTokens(tokenized.tokens, (token) =>
        resolveEpubImageToken(token, manifestItem.fullPath)
      );
      const chapterTitle = tokenized.title || `Chapter ${index + 1}`;
      const chapter = buildChapterFromBlocks(chapterTitle, blocks);
      if (!chapter.content && (!chapter.blocks || chapter.blocks.length === 0)) continue;
      chapters.push(chapter);
    }
  }

  const fullText = normalizeTextBlock(chapters.map((chapter) => chapter.content).filter(Boolean).join('\n\n'));
  const title = findXmlTextByLocalName(opfDoc, 'title') || trimFileExt(file.name);
  const author = findXmlTextByLocalName(opfDoc, 'creator') || '作者名';
  return {
    format: 'epub' as const,
    title: compactWhitespace(title) || trimFileExt(file.name),
    author: compactWhitespace(author) || '作者名',
    coverUrl,
    fullText,
    chapters: chapters.length > 0 ? chapters : buildFallbackSingleChapter('全文', fullText),
  };
};

const renderPdfPageToBlob = async (page: any, maxWidth: number) => {
  const viewport = page.getViewport({ scale: 1 });
  const safeMaxWidth = Math.max(80, Math.round(maxWidth));
  const scale = Math.min(1, safeMaxWidth / Math.max(viewport.width || 1, 1));
  const drawViewport = page.getViewport({ scale: Math.max(scale, 0.25) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(drawViewport.width));
  canvas.height = Math.max(1, Math.floor(drawViewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  await page.render({ canvasContext: context, viewport: drawViewport }).promise;
  return canvasToBlob(canvas, 'image/jpeg', 0.82);
};

const resolvePdfRgbaImageBlob = async (source: { width: number; height: number; data: Uint8ClampedArray }) => {
  if (!source.width || !source.height || !source.data) return null;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const imageData = context.createImageData(source.width, source.height);
  imageData.data.set(source.data);
  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, 'image/png');
};

const resolvePdfDrawableImageBlob = async (source: HTMLImageElement | ImageBitmap | HTMLCanvasElement) => {
  const width = isCanvasLike(source)
    ? source.width
    : isImageLike(source)
    ? source.naturalWidth || source.width
    : source.width;
  const height = isCanvasLike(source)
    ? source.height
    : isImageLike(source)
    ? source.naturalHeight || source.height
    : source.height;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvasToBlob(canvas, 'image/png');
};

const resolvePdfImageObjectBlob = async (source: any): Promise<Blob | null> => {
  if (!source) return null;
  if (
    typeof source.width === 'number' &&
    typeof source.height === 'number' &&
    source.data instanceof Uint8ClampedArray
  ) {
    return resolvePdfRgbaImageBlob(source);
  }
  if (source.bitmap && (isImageBitmapLike(source.bitmap) || isCanvasLike(source.bitmap))) {
    return resolvePdfDrawableImageBlob(source.bitmap);
  }
  if (isCanvasLike(source) || isImageLike(source) || isImageBitmapLike(source)) {
    return resolvePdfDrawableImageBlob(source);
  }
  return null;
};

const extractPdfPageImageRefs = async (page: any, context: ImportParseContext) => {
  const imageRefs: string[] = [];
  const operatorList = await page.getOperatorList().catch(() => null);
  const OPS = (pdfjsLib as any).OPS || {};
  if (!operatorList || !Array.isArray(operatorList.fnArray) || !Array.isArray(operatorList.argsArray)) {
    return imageRefs;
  }

  const seenObjectNames = new Set<string>();
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] || [];
    let imageBlob: Blob | null = null;

    if (fn === OPS.paintInlineImageXObject) {
      imageBlob = await resolvePdfImageObjectBlob(args[0]).catch(() => null);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      const imageName = typeof args[0] === 'string' ? args[0] : '';
      if (!imageName || seenObjectNames.has(imageName)) continue;
      seenObjectNames.add(imageName);
      const source = typeof page.objs?.get === 'function' ? page.objs.get(imageName) : null;
      imageBlob = await resolvePdfImageObjectBlob(source).catch(() => null);
    }

    if (!imageBlob) continue;
    const imageRef = await collectImageRef(imageBlob, context);
    imageRefs.push(imageRef);
  }

  return imageRefs;
};

const parsePdfFile = async (file: File, context: ImportParseContext) => {
  ensurePdfWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  const pdfDocument: any = await loadingTask.promise;

  let title = trimFileExt(file.name);
  let author = '佚名';
  const metadata = await pdfDocument.getMetadata().catch(() => null);
  if (metadata?.info) {
    const info = metadata.info as Record<string, unknown>;
    if (typeof info.Title === 'string' && compactWhitespace(info.Title)) {
      title = compactWhitespace(info.Title);
    }
    if (typeof info.Author === 'string' && compactWhitespace(info.Author)) {
      author = compactWhitespace(info.Author);
    }
  }

  let coverUrl = '';
  const chapterBlocks: ReaderContentBlock[] = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    if (pageNumber === 1) {
      const coverBlob = await renderPdfPageToBlob(page, 480);
      if (coverBlob) {
        coverUrl = await collectImageRef(coverBlob, context);
      }
    }

    const textContent = await page.getTextContent().catch(() => null);
    const pageText = normalizeTextBlock(
      textContent && Array.isArray(textContent.items)
        ? textContent.items
            .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
            .join(' ')
        : ''
    );
    if (pageText) {
      chapterBlocks.push({
        type: 'text',
        text: pageText,
      });
    }

    const pageImageRefs = await extractPdfPageImageRefs(page, context);
    pageImageRefs.forEach((imageRef) => {
      chapterBlocks.push({
        type: 'image',
        imageRef,
        alt: `PDF page ${pageNumber} image`,
        title: `PDF page ${pageNumber} image`,
      });
    });

    if (!pageText && pageImageRefs.length === 0) {
      const fallbackBlob = await renderPdfPageToBlob(page, 780);
      if (fallbackBlob) {
        const imageRef = await collectImageRef(fallbackBlob, context);
        chapterBlocks.push({
          type: 'image',
          imageRef,
          alt: `PDF page ${pageNumber}`,
          title: `PDF page ${pageNumber}`,
        });
      }
    }
  }

  await loadingTask.destroy();
  const chapter = buildChapterFromBlocks('全文', chapterBlocks);
  const fullText = chapter.content;
  return {
    format: 'pdf' as const,
    title,
    author,
    coverUrl,
    fullText,
    chapters: [chapter],
  };
};

const detectFormat = (file: File): SupportedImportFormat => {
  const suffix = getFileSuffix(file.name);
  if (TXT_SUFFIXES.has(suffix)) return 'txt';
  if (WORD_SUFFIXES.has(suffix)) return 'word';
  if (EPUB_SUFFIXES.has(suffix)) return 'epub';
  if (PDF_SUFFIXES.has(suffix)) return 'pdf';
  throw new Error(`Unsupported file format: .${suffix || 'unknown'}`);
};

export const isSupportedBookImportFile = (fileName: string) => {
  const suffix = getFileSuffix(fileName);
  return SUPPORTED_SUFFIXES.includes(suffix);
};

export const parseImportedBookFile = async (file: File): Promise<ParsedBookImportResult> => {
  const context: ImportParseContext = {
    generatedImageRefs: [],
  };

  try {
    const format = detectFormat(file);
    const parsed =
      format === 'txt'
        ? await parseTxtFile(file)
        : format === 'word'
        ? await parseWordFile(file, context)
        : format === 'epub'
        ? await parseEpubFile(file, context)
        : await parsePdfFile(file, context);

    const normalizedFullText = normalizeTextBlock(parsed.fullText || '');
    const normalizedChapters =
      parsed.chapters.length > 0
        ? parsed.chapters
            .map((chapter) => buildChapterFromBlocks(chapter.title, chapter.blocks || [{ type: 'text', text: chapter.content }]))
            .filter((chapter) => chapter.content || (chapter.blocks && chapter.blocks.length > 0))
        : buildFallbackSingleChapter('全文', normalizedFullText);

    return {
      ...parsed,
      title: compactWhitespace(parsed.title) || trimFileExt(file.name),
      author: compactWhitespace(parsed.author) || '佚名',
      fullText: normalizedFullText,
      chapters: normalizedChapters,
      generatedImageRefs: [...context.generatedImageRefs],
    };
  } catch (error) {
    await deleteGeneratedImages(context.generatedImageRefs);
    throw error;
  }
};

