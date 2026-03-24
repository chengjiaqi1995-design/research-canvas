import { SearchServiceClient, DocumentServiceClient } from '@google-cloud/discoveryengine';

const projectId = process.env.GCP_PROJECT_ID || 'ainotebook-1baa3';
const location = 'global';
const dataStoreId = process.env.VERTEX_AI_DATASTORE_ID || '';
const appId = process.env.VERTEX_AI_APP_ID || '';

// 初始化客户端
const searchClient = new SearchServiceClient();
const documentClient = new DocumentServiceClient();

// 获取服务配置路径
function getServingConfig() {
  const id = appId || dataStoreId;
  if (!id) {
    throw new Error('VERTEX_AI_APP_ID 或 VERTEX_AI_DATASTORE_ID 未配置');
  }
  
  if (appId) {
    return `projects/${projectId}/locations/${location}/collections/default_collection/engines/${appId}/servingConfigs/default_config`;
  } else {
    return `projects/${projectId}/locations/${location}/collections/default_collection/dataStores/${dataStoreId}/servingConfigs/default_config`;
  }
}

function getBranch() {
  const id = dataStoreId;
  if (!id) {
    throw new Error('VERTEX_AI_DATASTORE_ID 未配置');
  }
  return `projects/${projectId}/locations/${location}/collections/default_collection/dataStores/${id}/branches/default_branch`;
}

/**
 * 搜索文档
 */
export async function searchDocuments(
  query: string, 
  pageSize: number = 10, 
  pageToken?: string,
  filters?: {
    topic?: string;
    organization?: string;
    participants?: string;
    startDate?: string;
    endDate?: string;
  }
) {
  try {
    if (!dataStoreId && !appId) {
      throw new Error('VERTEX_AI_APP_ID 或 VERTEX_AI_DATASTORE_ID 环境变量未配置');
    }

    const servingConfig = getServingConfig();
    console.log('🔍 执行搜索:', { query, servingConfig, pageSize, filters });

    const request: any = {
      servingConfig,
      query,
      pageSize,
      queryExpansionSpec: { condition: 'AUTO' },
      spellCorrectionSpec: { mode: 'AUTO' },
    };

    // 构建过滤条件
    if (filters) {
      const filterParts: string[] = [];
      
      if (filters.topic) {
        filterParts.push(`topic: ANY("${filters.topic}")`);
      }
      if (filters.organization) {
        filterParts.push(`organization: ANY("${filters.organization}")`);
      }
      if (filters.participants) {
        filterParts.push(`participants: ANY("${filters.participants}")`);
      }
      
      // 发生时间段过滤
      if (filters.startDate && filters.endDate) {
        // eventDate 是字符串格式（YYYY/MM/DD），使用字符串比较
        filterParts.push(`eventDate >= "${filters.startDate}"`);
        filterParts.push(`eventDate <= "${filters.endDate}"`);
        console.log('📅 应用时间段过滤:', filters.startDate, '至', filters.endDate);
      }
      
      if (filterParts.length > 0) {
        request.filter = filterParts.join(' AND ');
        console.log('🔧 应用过滤:', request.filter);
      }
    }

    if (pageToken) {
      request.pageToken = pageToken;
    }

    const [response] = await searchClient.search(request) as any[];
    
    console.log('📊 搜索原始结果:', {
      resultsCount: response?.results?.length || 0,
      totalSize: response?.totalSize,
      hasNextPage: !!response?.nextPageToken,
    });

    // 转换搜索结果格式，解析 structData fields
    const formattedResults = (response?.results || []).map((result: any) => {
      const document = result.document || {};
      const structData = document.structData?.fields || {};
      
      // 从 Protobuf fields 格式转换为普通对象
      const parseField = (field: any) => {
        if (!field) return undefined;
        if (field.stringValue !== undefined) return field.stringValue;
        if (field.numberValue !== undefined) return field.numberValue;
        if (field.boolValue !== undefined) return field.boolValue;
        if (field.listValue?.values) {
          return field.listValue.values.map((v: any) => parseField(v));
        }
        return undefined;
      };

      return {
        ...result,
        document: {
          ...document,
          structData: {
            content: parseField(structData.content),
            fileName: parseField(structData.title) || parseField(structData.fileName),
            topic: parseField(structData.topic),
            organization: parseField(structData.organization),
            participants: parseField(structData.participants),
            eventDate: parseField(structData.eventDate),
            tags: parseField(structData.tags) || [],
            createdAt: parseField(structData.createdAt),
          },
        },
      };
    });

    console.log('✅ 转换后的搜索结果:', {
      resultsCount: formattedResults.length,
      firstResult: formattedResults[0]?.document?.structData,
    });

    return {
      results: formattedResults,
      nextPageToken: response?.nextPageToken,
      totalSize: response?.totalSize,
    };
  } catch (error: any) {
    console.error('❌ Vertex AI 搜索失败:', error.message);
    console.error('完整错误:', error);
    throw new Error(`搜索失败: ${error.message}`);
  }
}

/**
 * 索引单个文档
 */
export async function indexDocument(documentId: string, content: string, metadata?: Record<string, any>) {
  try {
    if (!dataStoreId) {
      throw new Error('VERTEX_AI_DATASTORE_ID 环境变量未配置');
    }

    const branch = getBranch();

    // 构建包含所有信息的完整文本内容
    const fullContent = `
标题: ${metadata?.fileName || ''}
主题: ${metadata?.topic || ''}
机构: ${metadata?.organization || ''}
参与人: ${metadata?.participants || ''}
发生时间: ${metadata?.eventDate || ''}
标签: ${metadata?.tags?.join(', ') || ''}
创建时间: ${metadata?.createdAt || ''}

内容:
${content}
    `.trim();

    // 使用 content 字段，以 base64 编码的方式
    const document: any = {
      id: documentId,
      content: {
        mimeType: 'text/plain',
        rawBytes: Buffer.from(fullContent, 'utf-8').toString('base64'),
      },
      structData: {
        fields: {
          title: { stringValue: metadata?.fileName || '' },
          topic: { stringValue: metadata?.topic || '' },
          organization: { stringValue: metadata?.organization || '' },
          participants: { stringValue: metadata?.participants || '' },
          eventDate: { stringValue: metadata?.eventDate || '' },
          tags: { listValue: { values: (metadata?.tags || []).map((tag: string) => ({ stringValue: tag })) } },
          createdAt: { stringValue: metadata?.createdAt || '' },
        },
      },
    };

    try {
      // 先尝试创建文档
      const request = {
        parent: branch,
        document,
        documentId,
      };

      const [operation] = await documentClient.createDocument(request);
      console.log(`✅ 文档 ${documentId} 创建成功`);
      return operation;
    } catch (createError: any) {
      // 如果文档已存在，则更新文档
      if (createError.message.includes('ALREADY_EXISTS')) {
        console.log(`📝 文档 ${documentId} 已存在，尝试更新...`);
        return await updateDocument(documentId, content, metadata);
      }
      throw createError;
    }
  } catch (error: any) {
    console.error(`❌ 文档 ${documentId} 索引失败:`, error.message);
    throw new Error(`索引失败: ${error.message}`);
  }
}

/**
 * 批量索引文档
 */
export async function batchIndexDocuments(documents: Array<{ id: string; content: string; metadata?: Record<string, any> }>) {
  try {
    if (!dataStoreId) {
      throw new Error('VERTEX_AI_DATASTORE_ID 环境变量未配置');
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
      successIds: [] as string[],
    };

    const promises = documents.map((doc) =>
      indexDocument(doc.id, doc.content, doc.metadata)
        .then(() => {
          results.success++;
          results.successIds.push(doc.id);
        })
        .catch((error) => {
          results.failed++;
          results.errors.push(`${doc.id}: ${error.message}`);
        })
    );

    await Promise.allSettled(promises);

    console.log(`📊 批量索引完成: 成功 ${results.success}, 失败 ${results.failed}`);

    return results;
  } catch (error: any) {
    console.error('❌ 批量索引失败:', error.message);
    throw new Error(`批量索引失败: ${error.message}`);
  }
}

/**
 * 更新文档
 */
export async function updateDocument(documentId: string, content: string, metadata?: Record<string, any>) {
  try {
    if (!dataStoreId) {
      throw new Error('VERTEX_AI_DATASTORE_ID 环境变量未配置');
    }

    const branch = getBranch();
    const documentName = `${branch}/documents/${documentId}`;

    // 构建包含所有信息的完整文本内容
    const fullContent = `
标题: ${metadata?.fileName || ''}
主题: ${metadata?.topic || ''}
机构: ${metadata?.organization || ''}
参与人: ${metadata?.participants || ''}
发生时间: ${metadata?.eventDate || ''}
标签: ${metadata?.tags?.join(', ') || ''}
创建时间: ${metadata?.createdAt || ''}

内容:
${content}
    `.trim();

    const document: any = {
      name: documentName,
      id: documentId,
      content: {
        mimeType: 'text/plain',
        rawBytes: Buffer.from(fullContent, 'utf-8').toString('base64'),
      },
      structData: {
        fields: {
          title: { stringValue: metadata?.fileName || '' },
          topic: { stringValue: metadata?.topic || '' },
          organization: { stringValue: metadata?.organization || '' },
          participants: { stringValue: metadata?.participants || '' },
          eventDate: { stringValue: metadata?.eventDate || '' },
          tags: { listValue: { values: (metadata?.tags || []).map((tag: string) => ({ stringValue: tag })) } },
          createdAt: { stringValue: metadata?.createdAt || '' },
        },
      },
    };

    const request = {
      document,
      allowMissing: false,
    };

    const [operation] = await documentClient.updateDocument(request);
    console.log(`✅ 文档 ${documentId} 更新成功`);

    return operation;
  } catch (error: any) {
    console.error(`❌ 文档 ${documentId} 更新失败:`, error.message);
    throw new Error(`更新失败: ${error.message}`);
  }
}

/**
 * 删除文档
 */
export async function deleteDocument(documentId: string) {
  try {
    if (!dataStoreId) {
      throw new Error('VERTEX_AI_DATASTORE_ID 环境变量未配置');
    }

    const branch = getBranch();
    const documentName = `${branch}/documents/${documentId}`;

    const request = {
      name: documentName,
    };

    await documentClient.deleteDocument(request);
    console.log(`✅ 文档 ${documentId} 删除成功`);

    return { success: true };
  } catch (error: any) {
    console.error(`❌ 文档 ${documentId} 删除失败:`, error.message);
    throw new Error(`删除失败: ${error.message}`);
  }
}

/**
 * 检查 Vertex AI Search 配置状态
 */
export async function checkVertexAIStatus() {
  try {
    if (!dataStoreId && !appId) {
      return {
        configured: false,
        message: 'VERTEX_AI_APP_ID 或 VERTEX_AI_DATASTORE_ID 环境变量未配置',
      };
    }

    await searchDocuments('test', 1);

    return {
      configured: true,
      projectId,
      dataStoreId,
      appId,
      location,
      message: 'Vertex AI Search 已配置并可用',
    };
  } catch (error: any) {
    return {
      configured: false,
      projectId,
      dataStoreId,
      appId,
      location,
      message: `配置错误: ${error.message}`,
    };
  }
}

/**
 * 获取索引进度
 */
export async function getIndexProgress() {
  try {
    if (!dataStoreId) {
      throw new Error('VERTEX_AI_DATASTORE_ID 环境变量未配置');
    }

    const branch = getBranch();

    // 获取已上传的文档数
    let uploadedCount = 0;
    try {
      const request = {
        parent: branch,
        pageSize: 100,
      };

      const iterable = documentClient.listDocumentsAsync(request);
      for await (const document of iterable) {
        uploadedCount++;
      }
    } catch (error: any) {
      console.error('获取文档列表失败:', error.message);
    }

    // 获取已索引的文档数
    let indexedCount = 0;
    try {
      const servingConfig = getServingConfig();
      const searchRequest = {
        servingConfig,
        query: 'test',
        pageSize: 1,
      };

      const [searchResponse] = await searchClient.search(searchRequest) as any[];
      indexedCount = searchResponse?.totalSize || 0;
    } catch (error: any) {
      console.error('获取索引数失败:', error.message);
    }

    const percentage = uploadedCount > 0 ? Math.round((indexedCount / uploadedCount) * 100) : 0;
    const isComplete = uploadedCount > 0 && indexedCount >= uploadedCount;

    return {
      uploaded: uploadedCount,
      indexed: indexedCount,
      percentage,
      isComplete,
    };
  } catch (error: any) {
    console.error('❌ 获取索引进度失败:', error.message);
    throw new Error(`获取索引进度失败: ${error.message}`);
  }
}