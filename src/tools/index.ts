import { readFileTool } from "./read-file.ts";
import { writeFileTool } from "./write-file.ts";
import { editFileTool } from "./edit-file.ts";
import { bashTool } from "./bash.ts";

export const tools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  bash: bashTool,
};
