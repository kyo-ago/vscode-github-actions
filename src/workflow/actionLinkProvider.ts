import * as vscode from "vscode";
import * as path from "path";

import {convertWorkflowTemplate, NoOperationTraceWriter, parseWorkflow} from "@actions/workflow-parser";
import type {WorkflowTemplate} from "@actions/workflow-parser/model/workflow-template";
import type {File} from "@actions/workflow-parser/workflows/file";

export class GitHubActionsLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];

    try {
      const file: File = {
        name: document.uri.fsPath,
        content: document.getText()
      };

      const parseResult = parseWorkflow(file, new NoOperationTraceWriter());

      if (!parseResult.value || token.isCancellationRequested) {
        return links;
      }

      const workflowTemplate: WorkflowTemplate = await convertWorkflowTemplate(
        parseResult.context,
        parseResult.value
      );

      if (token.isCancellationRequested) {
        return links;
      }

      // Process jobs and their steps
      for (const job of workflowTemplate.jobs) {
        if (job.type === "job" && "steps" in job) {
          for (const step of job.steps) {
            if ("uses" in step && step.uses) {
              const usesToken = step.uses;
              const usesValue = usesToken.value;

              // Convert 1-based token position to 0-based VSCode position
              if (usesToken.range) {
                const startPos = new vscode.Position(
                  usesToken.range.start.line - 1,
                  usesToken.range.start.column - 1
                );
                const endPos = new vscode.Position(
                  usesToken.range.end.line - 1,
                  usesToken.range.end.column - 1
                );
                const range = new vscode.Range(startPos, endPos);

                const targetUri = this.resolveUsesPath(document, usesValue);
                if (targetUri) {
                  const link = new vscode.DocumentLink(range, targetUri);
                  links.push(link);
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore parsing errors
    }

    return links;
  }

  private resolveUsesPath(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
    // Handle local actions (starting with ./)
    if (usesValue.startsWith("./")) {
      return this.resolveLocalAction(document, usesValue);
    }

    // Handle external GitHub actions (org/repo format)
    if (usesValue.includes("/")) {
      return this.resolveGitHubAction(usesValue);
    }

    return null;
  }

  private resolveLocalAction(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return null;
    }

    let relativePath = usesValue.substring(2);

    const atIndex = relativePath.indexOf("@");
    if (atIndex !== -1) {
      relativePath = relativePath.substring(0, atIndex);
    }

    // Check if the path already ends with .yml or .yaml
    const hasYamlExtension = relativePath.endsWith(".yml") || relativePath.endsWith(".yaml");

    if (hasYamlExtension) {
      return null;
    }

    // If no YAML extension, add /action.yml by default
    const actionPath = path.join(workspaceFolder.uri.fsPath, relativePath, "action.yml");
    return vscode.Uri.file(actionPath);
  }

  private resolveGitHubAction(usesValue: string): vscode.Uri | null {
    // Remove version tag if present
    const atIndex = usesValue.indexOf("@");
    const actionPath = atIndex !== -1 ? usesValue.substring(0, atIndex) : usesValue;

    // Split into parts: org/repo or org/repo/subpath
    const parts = actionPath.split("/");
    if (parts.length < 2) {
      return null;
    }

    const org = parts[0];
    const repo = parts[1];
    const subPath = parts.slice(2).join("/");

    // Construct GitHub URL
    let githubUrl: string;
    if (subPath) {
      // Action is in a subdirectory
      githubUrl = `https://github.com/${org}/${repo}/tree/main/${subPath}`;
    } else {
      // Action is at repository root
      githubUrl = `https://github.com/${org}/${repo}`;
    }

    return vscode.Uri.parse(githubUrl);
  }
}
