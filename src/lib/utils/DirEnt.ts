import { Dirent } from 'fs'

const File = "File"
const Folder = "Folder"
type FileOrFolder = typeof File | typeof Folder
const Visible = "Visible"
const Hidden = "Hidden"
type Visibility = typeof Visible | typeof Hidden

type DirEnt = {
  readonly type: FileOrFolder,
  readonly visibility: Visibility,
  readonly dirent?: Dirent<string>
}
type AcceptedCreateInput = ({ isDirectory: () => boolean, } | { directory: boolean } ) & ({ name: string } | { visibility: Visibility })
type FilterInput = DirEnt|Dirent<string>

const create = (item: AcceptedCreateInput): DirEnt => {
  let directory: boolean
  let dirent: Dirent<string>|undefined = undefined
  if ("isDirectory" in item) {
    directory = item.isDirectory()
    dirent = item as Dirent<string>
  } else {
    directory = item.directory
  }
  let visibility: boolean
  if ("name" in item) {
    visibility = item.name.startsWith(".")
  } else if ("visible" in item) {
    visibility = item.visibility === Visible
  } else {
    visibility = true
  }
  return {
    type: directory ? Folder : File,
    visibility: visibility ? Hidden : Visible,
    dirent
  } as DirEnt
}
const noHiddenFiles = create({ directory: false, visibility: Visible })
const allFiles = create({ directory: false, visibility: Hidden })
const noHiddenFolders = create({ directory: true, visibility: Visible })
const allFolders = create({ directory: true, visibility: Hidden })

export enum FilterDirEntResult {
  discard,
  file,
  folder
}

const DirEnt = {
  create,
  filter (nec: DirEnt, includeHidden: boolean): FilterDirEntResult {
    if (!includeHidden && !nec.visibility)
      return FilterDirEntResult.discard
    if (nec.type === Folder)
      return FilterDirEntResult.folder
    else if (nec.type === File)
      return FilterDirEntResult.file
    else
      return FilterDirEntResult.discard
  },
  compare(nec: DirEnt, opt: FilterInput): boolean {
    if (opt instanceof Dirent) opt = DirEnt.create(opt) as DirEnt

    if (nec.type !== opt.type) {
      return false
    }
    if (!nec.visibility && opt.visibility) {
      return false
    }
    return true
  },
  allFiles(opt: FilterInput) { return DirEnt.compare(allFiles, opt) },
  noHiddenFiles(opt: FilterInput) { return DirEnt.compare(noHiddenFiles, opt) },
  allFolders(opt: FilterInput) { return DirEnt.compare(allFolders, opt) },
  noHiddenFolders(opt: FilterInput) { return DirEnt.compare(noHiddenFolders, opt) }
}

export default DirEnt