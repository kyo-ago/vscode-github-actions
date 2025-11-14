import * as vscode from 'vscode';
import * as path from 'path';
import {parseWorkflow} from '@actions/workflow-parser';
import {convertWorkflowTemplate} from '@actions/workflow-parser';
import {NoOperationTraceWriter} from '@actions/workflow-parser';
import type {WorkflowTemplate} from '@actions/workflow-parser/model/workflow-template';
import type {File} from '@actions/workflow-parser/workflows/file';

export class GitHubActionsLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];

    try {
      // Create a File object for the workflow parser
      const file: File = {
        name: document.uri.fsPath,
        content: document.getText()
      };

      // Parse the workflow
      const parseResult = parseWorkflow(file, new NoOperationTraceWriter());

      if (!parseResult.value || token.isCancellationRequested) {
        return links;
      }

      // Convert to workflow template
      const workflowTemplate: WorkflowTemplate = await convertWorkflowTemplate(
        parseResult.context,
        parseResult.value
      );

      if (token.isCancellationRequested) {
        return links;
      }

      // Process jobs and their steps
      for (const job of workflowTemplate.jobs) {
        if (job.type === 'job' && 'steps' in job) {
          for (const step of job.steps) {
            // Check if this is an ActionStep (has 'uses')
            if ('uses' in step && step.uses) {
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
    } catch (error) {
      console.error('Error parsing workflow:', error);
    }

    console.log(`Total links found: ${links.length}`);
    return links;
  }

  private resolveUsesPath(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
    console.log(`Resolving uses path: ${usesValue}`);

    // Handle local actions (starting with ./)
    if (usesValue.startsWith('./')) {
      return this.resolveLocalAction(document, usesValue);
    }

    // Handle external GitHub actions (org/repo format)
    if (usesValue.includes('/')) {
      return this.resolveGitHubAction(usesValue);
    }

    console.log(`Unknown action format: ${usesValue}`);
    return null;
  }

  private resolveLocalAction(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      console.log('No workspace folder found');
      return null;
    }

    let relativePath = usesValue.substring(2);

    const atIndex = relativePath.indexOf('@');
    if (atIndex !== -1) {
      relativePath = relativePath.substring(0, atIndex);
      console.log(`Stripped version tag, path: ${relativePath}`);
    }

    // Check if the path already ends with .yml or .yaml
    const hasYamlExtension = relativePath.endsWith('.yml') || relativePath.endsWith('.yaml');

    if (hasYamlExtension) {
      console.log(`Path already has YAML extension, skipping: ${relativePath}`);
      return null;
    }

    // If no YAML extension, add /action.yml by default
    // VSCode will handle if the file doesn't exist
    const actionPath = path.join(workspaceFolder.uri.fsPath, relativePath, 'action.yml');
    console.log(`Resolved local action path: ${actionPath}`);
    return vscode.Uri.file(actionPath);
  }

  private resolveGitHubAction(usesValue: string): vscode.Uri | null {
    // Remove version tag if present
    const atIndex = usesValue.indexOf('@');
    const actionPath = atIndex !== -1 ? usesValue.substring(0, atIndex) : usesValue;

    // Split into parts: org/repo or org/repo/subpath
    const parts = actionPath.split('/');
    if (parts.length < 2) {
      console.log(`Invalid GitHub action format: ${usesValue}`);
      return null;
    }

    const org = parts[0];
    const repo = parts[1];
    const subPath = parts.slice(2).join('/');

    // Construct GitHub URL
    let githubUrl: string;
    if (subPath) {
      // Action is in a subdirectory
      githubUrl = `https://github.com/${org}/${repo}/tree/main/${subPath}`;
      console.log(`GitHub action with subpath: ${githubUrl}`);
    } else {
      // Action is at repository root
      githubUrl = `https://github.com/${org}/${repo}`;
      console.log(`GitHub action at repo root: ${githubUrl}`);
    }

    return vscode.Uri.parse(githubUrl);
  }
}
