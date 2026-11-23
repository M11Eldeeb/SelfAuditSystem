/** Claim document types that take several files (the others take exactly one). Used by the form and by the save. */
export const MULTI_PHOTO_TYPES: ReadonlySet<string> = new Set(["photo_parts_requisition"]);

/** Most files a multi-file document type may hold. */
export const MAX_MULTI_FILES = 20;
