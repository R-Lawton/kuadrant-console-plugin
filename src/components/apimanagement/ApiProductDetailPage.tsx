import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom-v5-compat';
import {
  PageSection,
  Title,
  Alert,
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  Label,
  LabelGroup,
  Button,
  Content,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Skeleton,
} from '@patternfly/react-core';
import { ArrowLeftIcon } from '@patternfly/react-icons';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { APIProduct, APIProductGVK } from '../../types/api-management';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

// Hardcoded OpenAPI spec for testing
const DEMO_OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Sample API',
    description: 'A sample API to demonstrate OpenAPI spec rendering',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'https://api.example.com/v1',
      description: 'Production server',
    },
  ],
  paths: {
    '/pets': {
      get: {
        summary: 'List all pets',
        operationId: 'listPets',
        tags: ['pets'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'How many items to return at one time (max 100)',
            required: false,
            schema: {
              type: 'integer',
              format: 'int32',
            },
          },
        ],
        responses: {
          '200': {
            description: 'A paged array of pets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Pet',
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a pet',
        operationId: 'createPets',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Pet',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Pet created',
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        summary: 'Info for a specific pet',
        operationId: 'showPetById',
        tags: ['pets'],
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            description: 'The id of the pet to retrieve',
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Expected response to a valid request',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Pet',
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: {
            type: 'integer',
            format: 'int64',
          },
          name: {
            type: 'string',
          },
          tag: {
            type: 'string',
          },
        },
      },
    },
  },
};

export const ApiProductDetailPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console-plugin');
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const navigate = useNavigate();

  const [product, loaded, error] = useK8sWatchResource<APIProduct>({
    groupVersionKind: APIProductGVK,
    name,
    namespace,
  });

  const handleBack = () => {
    navigate(-1);
  };

  if (error) {
    return (
      <PageSection>
        <Alert variant="danger" title={t('Error loading API product')}>
          {error.message}
        </Alert>
      </PageSection>
    );
  }

  if (!loaded) {
    return (
      <PageSection>
        <Skeleton height="200px" />
      </PageSection>
    );
  }

  if (!product) {
    return (
      <PageSection>
        <Alert variant="warning" title={t('API product not found')} />
      </PageSection>
    );
  }

  const { spec, status } = product;
  const displayName = spec.displayName || product.metadata?.name || '';
  const tags = spec.tags || [];

  // Use hardcoded spec for now, fall back to status.openapi.raw when controller is running
  const openApiSpec = status?.openapi?.raw ? JSON.parse(status.openapi.raw) : DEMO_OPENAPI_SPEC;
  const hasOpenAPI = true; // Always show for demo

  return (
    <>
      <PageSection variant="secondary">
        <Grid hasGutter>
          <GridItem>
            <Button variant="link" icon={<ArrowLeftIcon />} onClick={handleBack} isInline>
              {t('Back to Browse APIs')}
            </Button>
          </GridItem>
          <GridItem>
            <Title headingLevel="h1">{displayName}</Title>
            {spec.description && <Content>{spec.description}</Content>}
            {tags.length > 0 && (
              <LabelGroup style={{ marginTop: 'var(--pf-v6-global--spacer--sm)' }}>
                {tags.map((tag) => (
                  <Label key={tag} isCompact>
                    {tag}
                  </Label>
                ))}
              </LabelGroup>
            )}
          </GridItem>
        </Grid>
      </PageSection>

      <PageSection>
        <Grid hasGutter>
          <GridItem span={8}>
            {hasOpenAPI ? (
              <Card>
                <CardTitle>{t('API Documentation')}</CardTitle>
                <CardBody>
                  <SwaggerUI spec={openApiSpec} />
                </CardBody>
              </Card>
            ) : (
              <Alert variant="info" title={t('No OpenAPI specification available')}>
                {t(
                  'The OpenAPI specification for this API is not available. Contact the API owner for documentation.',
                )}
              </Alert>
            )}
          </GridItem>

          <GridItem span={4}>
            <Card>
              <CardTitle>{t('API Information')}</CardTitle>
              <CardBody>
                <DescriptionList isCompact>
                  {spec.version && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Version')}</DescriptionListTerm>
                      <DescriptionListDescription>{spec.version}</DescriptionListDescription>
                    </DescriptionListGroup>
                  )}

                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Publish Status')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <Label color={spec.publishStatus === 'Published' ? 'green' : 'grey'}>
                        {spec.publishStatus}
                      </Label>
                    </DescriptionListDescription>
                  </DescriptionListGroup>

                  <DescriptionListGroup>
                    <DescriptionListTerm>{t('Approval Mode')}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {spec.approvalMode === 'automatic' ? t('Automatic') : t('Manual')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>

                  {spec.targetRef && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Target')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {spec.targetRef.kind}: {spec.targetRef.name}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}

                  {status?.discoveredPlans && status.discoveredPlans.length > 0 && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t('Available Plans')}</DescriptionListTerm>
                      <DescriptionListDescription>
                        <LabelGroup>
                          {status.discoveredPlans.map((plan) => (
                            <Label key={plan.tier} isCompact>
                              {plan.tier}
                            </Label>
                          ))}
                        </LabelGroup>
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                </DescriptionList>
              </CardBody>
            </Card>

            {spec.contact && (
              <Card style={{ marginTop: 'var(--pf-v6-global--spacer--md)' }}>
                <CardTitle>{t('Contact')}</CardTitle>
                <CardBody>
                  <DescriptionList isCompact>
                    {spec.contact.team && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Team')}</DescriptionListTerm>
                        <DescriptionListDescription>{spec.contact.team}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {spec.contact.email && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Email')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          <a href={`mailto:${spec.contact.email}`}>{spec.contact.email}</a>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {spec.contact.slack && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Slack')}</DescriptionListTerm>
                        <DescriptionListDescription>{spec.contact.slack}</DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {spec.contact.url && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('URL')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          <a href={spec.contact.url} target="_blank" rel="noopener noreferrer">
                            {spec.contact.url}
                          </a>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                  </DescriptionList>
                </CardBody>
              </Card>
            )}

            {spec.documentation && (
              <Card style={{ marginTop: 'var(--pf-v6-global--spacer--md)' }}>
                <CardTitle>{t('Additional Resources')}</CardTitle>
                <CardBody>
                  <DescriptionList isCompact>
                    {spec.documentation.openAPISpecURL && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('OpenAPI Spec')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          <a
                            href={spec.documentation.openAPISpecURL}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('View Spec')}
                          </a>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {spec.documentation.docsURL && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Documentation')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          <a
                            href={spec.documentation.docsURL}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('View Docs')}
                          </a>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                    {spec.documentation.gitRepository && (
                      <DescriptionListGroup>
                        <DescriptionListTerm>{t('Repository')}</DescriptionListTerm>
                        <DescriptionListDescription>
                          <a
                            href={spec.documentation.gitRepository}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('View Code')}
                          </a>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    )}
                  </DescriptionList>
                </CardBody>
              </Card>
            )}
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default ApiProductDetailPage;
