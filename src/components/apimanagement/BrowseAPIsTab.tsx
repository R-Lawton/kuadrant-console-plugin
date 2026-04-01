import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom-v5-compat';
import { Table, TableHeader, TableBody } from '@patternfly/react-table/deprecated';
import {
  Button,
  EmptyState,
  EmptyStateBody,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextArea,
  Alert,
  Content,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
  LabelGroup,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { useK8sWatchResource } from '@openshift-console/dynamic-plugin-sdk';
import { APIProduct, APIProductGVK, Plan } from '../../types/api-management';
import { createAccessRequest } from '../../utils/request-operations';

interface BrowseAPIsTabProps {
  userId: string;
  userEmail?: string;
  onRequestCreated?: () => void;
}

export const BrowseAPIsTab: React.FC<BrowseAPIsTabProps> = ({
  userId,
  userEmail,
  onRequestCreated,
}) => {
  const { t } = useTranslation('plugin__kuadrant-console-plugin');
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [selectedProduct, setSelectedProduct] = React.useState<APIProduct | null>(null);
  const [selectedPlan, setSelectedPlan] = React.useState<string>('');
  const [useCase, setUseCase] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // watch APIProducts across all namespaces
  const [products, productsLoaded, productsError] = useK8sWatchResource<APIProduct[]>({
    groupVersionKind: APIProductGVK,
    isList: true,
    namespaced: false,
  });

  // filter to only published products
  const publishedProducts = React.useMemo(() => {
    if (!productsLoaded || !products) return [];
    return products.filter((p) => p.spec.publishStatus === 'Published');
  }, [products, productsLoaded]);

  const handleRequestAccess = (product: APIProduct) => {
    setSelectedProduct(product);
    setError('');
    setUseCase('');
    // default to first available plan
    const plans = product.status?.discoveredPlans || [];
    setSelectedPlan(plans.length > 0 ? plans[0].tier : '');
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!selectedProduct) return;

    if (!selectedPlan) {
      setError('please select a plan');
      return;
    }

    setSubmitting(true);
    setError('');

    const result = await createAccessRequest({
      apiProductName: selectedProduct.metadata?.name || '',
      apiProductNamespace: selectedProduct.metadata?.namespace || '',
      planTier: selectedPlan,
      useCase: useCase.trim() || undefined,
      userId,
      userEmail,
    });

    setSubmitting(false);

    if (result.success) {
      setIsModalOpen(false);
      onRequestCreated?.();
    } else {
      setError(result.error || 'failed to create request');
    }
  };

  const formatLimits = (plan: Plan): string => {
    const parts: string[] = [];
    if (plan.limits?.daily) parts.push(`${plan.limits.daily.toLocaleString()}/day`);
    if (plan.limits?.weekly) parts.push(`${plan.limits.weekly.toLocaleString()}/week`);
    if (plan.limits?.monthly) parts.push(`${plan.limits.monthly.toLocaleString()}/month`);
    if (plan.limits?.yearly) parts.push(`${plan.limits.yearly.toLocaleString()}/year`);
    return parts.length > 0 ? parts.join(', ') : 'custom limits';
  };

  const columns = ['Name', 'Description', 'Version', 'Tags', 'Actions'];

  const rows = publishedProducts.map((product) => {
    const tags = product.spec.tags || [];
    const productName = product.spec.displayName || product.metadata?.name;

    return {
      cells: [
        {
          title: (
            <Button
              variant="link"
              isInline
              onClick={() =>
                navigate(
                  `/api-products/${product.metadata?.namespace}/${product.metadata?.name}`,
                )
              }
            >
              {productName}
            </Button>
          ),
        },
        product.spec.description || '-',
        product.spec.version || '-',
        {
          title:
            tags.length > 0 ? (
              <LabelGroup>
                {tags.slice(0, 3).map((tag) => (
                  <Label key={tag} isCompact>
                    {tag}
                  </Label>
                ))}
                {tags.length > 3 && <Label isCompact>+{tags.length - 3}</Label>}
              </LabelGroup>
            ) : (
              '-'
            ),
        },
        {
          title: (
            <Button variant="primary" onClick={() => handleRequestAccess(product)}>
              {t('Request Access')}
            </Button>
          ),
        },
      ],
    };
  });

  const availablePlans = selectedProduct?.status?.discoveredPlans || [];

  if (productsError) {
    return <Alert variant="danger" title={t('Error loading APIs')} />;
  }

  if (!productsLoaded) {
    return <div>{t('Loading...')}</div>;
  }

  if (publishedProducts.length === 0) {
    return (
      <EmptyState icon={CubesIcon} titleText={t('No APIs Available')}>
        <EmptyStateBody>
          {t('There are no published APIs available. Contact your administrator.')}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  return (
    <>
      <Table aria-label="Browse APIs table" variant="compact" cells={columns} rows={rows}>
        <TableHeader />
        <TableBody />
      </Table>

      <Modal
        variant="medium"
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        aria-labelledby="request-modal-title"
        aria-describedby="request-modal-body"
      >
        <ModalHeader title={t('Request API Access')} />
        <ModalBody>
          <Form>
            <FormGroup label={t('API')} isRequired>
              <Content>
                {selectedProduct?.spec.displayName || selectedProduct?.metadata?.name}
              </Content>
              {selectedProduct?.spec.description && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>{selectedProduct.spec.description}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>

            <FormGroup label={t('Plan Tier')} isRequired>
              {availablePlans.length > 0 ? (
                <>
                  <FormSelect
                    value={selectedPlan}
                    onChange={(_event, value) => setSelectedPlan(value)}
                  >
                    {availablePlans.map((plan) => (
                      <FormSelectOption
                        key={plan.tier}
                        value={plan.tier}
                        label={`${plan.tier} (${formatLimits(plan)})`}
                      />
                    ))}
                  </FormSelect>
                  {availablePlans.find((p) => p.tier === selectedPlan)?.description && (
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem>
                          {availablePlans.find((p) => p.tier === selectedPlan)?.description}
                        </HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  )}
                </>
              ) : (
                <Alert variant="warning" isInline title={t('No plans available')}>
                  {t('This API has no rate limit plans configured.')}
                </Alert>
              )}
            </FormGroup>

            <FormGroup label={t('Use Case')}>
              <TextArea
                value={useCase}
                onChange={(_event, value) => setUseCase(value)}
                placeholder={t('Describe your use case for accessing this API...')}
                rows={4}
              />
            </FormGroup>

            {error && <Alert variant="danger" title={error} isInline />}
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button
            key="submit"
            variant="primary"
            onClick={handleSubmit}
            isDisabled={submitting || availablePlans.length === 0}
            isLoading={submitting}
          >
            {t('Submit Request')}
          </Button>
          <Button key="cancel" variant="link" onClick={() => setIsModalOpen(false)}>
            {t('Cancel')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};
