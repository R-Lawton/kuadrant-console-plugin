import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom-v5-compat';
import { PageSection, Title, Alert } from '@patternfly/react-core';
import { BrowseAPIsTab } from './BrowseAPIsTab';
import { MyAPIsTab } from './MyAPIsTab';
import { MyApiKeysTab } from './MyApiKeysTab';
import { MyRequestsTab } from './MyRequestsTab';
import { ApprovalQueueTab } from './ApprovalQueueTab';
import { ApiKeyOverviewTab } from './ApiKeyOverviewTab';
import {
  useK8sWatchResource,
  NamespaceBar,
  useActiveNamespace,
} from '@openshift-console/dynamic-plugin-sdk';
import { useCurrentUser } from '../../utils/user-identity';

const ApiManagementPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console-plugin');
  const { ns } = useParams<{ ns: string }>();
  const [activeNamespace, setActiveNamespace] = useActiveNamespace();
  const navigate = useNavigate();
  const location = useLocation();
  const [requestRefresh, setRequestRefresh] = React.useState(0);

  // extract section from pathname
  const pathParts = location.pathname.split('/');
  const sectionFromPath = pathParts[pathParts.length - 1];
  const validSections = [
    'browse',
    'my-apis',
    'my-keys',
    'my-requests',
    'approval-queue',
    'api-key-overview',
  ];
  const currentSection = validSections.includes(sectionFromPath) ? sectionFromPath : 'browse';

  // sync namespace from URL
  React.useEffect(() => {
    if (ns && ns !== activeNamespace) {
      setActiveNamespace(ns);
    }
  }, [ns, activeNamespace, setActiveNamespace]);

  // get current user from openshift
  const currentUser = useCurrentUser();
  const userId = currentUser.userId;
  const userEmail = currentUser.email;

  // check if user has permission to view approval queue by watching configmaps across all namespaces
  const [configMaps, loaded] = useK8sWatchResource<any[]>({
    groupVersionKind: { group: '', version: 'v1', kind: 'ConfigMap' },
    isList: true,
    namespace: undefined, // watch all namespaces to check admin permissions
  });

  // simple permission check - if we can list all configmaps across namespaces, show admin tabs
  const canApproveRequests = loaded && Array.isArray(configMaps);

  const handleRequestCreated = () => {
    // trigger refresh of My Requests section by incrementing counter
    setRequestRefresh((prev) => prev + 1);
    // navigate to My Requests section
    const basePath =
      ns && ns !== '#ALL_NS#' ? `/api-management/ns/${ns}` : '/api-management/all-namespaces';
    navigate(`${basePath}/my-requests`);
  };

  const handleNamespaceChange = (newNamespace: string) => {
    if (newNamespace !== '#ALL_NS#') {
      navigate(`/api-management/ns/${newNamespace}/${currentSection}`, { replace: true });
    } else {
      navigate(`/api-management/all-namespaces/${currentSection}`, { replace: true });
    }
  };

  // render the appropriate section based on URL
  const renderSection = () => {
    switch (currentSection) {
      case 'browse':
        return (
          <BrowseAPIsTab
            userId={userId}
            userEmail={userEmail}
            onRequestCreated={handleRequestCreated}
          />
        );
      case 'my-apis':
        return <MyAPIsTab userId={userId} />;
      case 'my-keys':
        return <MyApiKeysTab userId={userId} />;
      case 'my-requests':
        return <MyRequestsTab key={requestRefresh} userId={userId} />;
      case 'approval-queue':
        return canApproveRequests ? (
          <ApprovalQueueTab userId={userId} />
        ) : (
          <BrowseAPIsTab
            userId={userId}
            userEmail={userEmail}
            onRequestCreated={handleRequestCreated}
          />
        );
      case 'api-key-overview':
        return canApproveRequests ? (
          <ApiKeyOverviewTab />
        ) : (
          <BrowseAPIsTab
            userId={userId}
            userEmail={userEmail}
            onRequestCreated={handleRequestCreated}
          />
        );
      default:
        return (
          <BrowseAPIsTab
            userId={userId}
            userEmail={userEmail}
            onRequestCreated={handleRequestCreated}
          />
        );
    }
  };

  // get section title
  const getSectionTitle = () => {
    switch (currentSection) {
      case 'browse':
        return t('Browse APIs');
      case 'my-apis':
        return t('My APIs');
      case 'my-keys':
        return t('My API Keys');
      case 'my-requests':
        return t('My Requests');
      case 'approval-queue':
        return t('Approval Queue');
      case 'api-key-overview':
        return t('API Key Overview');
      default:
        return t('Browse APIs');
    }
  };

  // handle user loading/error states
  if (!currentUser.loaded) {
    return (
      <>
        <NamespaceBar onNamespaceChange={handleNamespaceChange} />
        <PageSection variant="default">
          <div>{t('Loading...')}</div>
        </PageSection>
      </>
    );
  }

  if (currentUser.error || !userId) {
    return (
      <>
        <NamespaceBar onNamespaceChange={handleNamespaceChange} />
        <PageSection variant="default">
          <Alert variant="danger" title={t('Failed to load user identity')} isInline>
            {currentUser.error?.message || t('Unable to determine current user.')}
          </Alert>
        </PageSection>
      </>
    );
  }

  return (
    <>
      <NamespaceBar onNamespaceChange={handleNamespaceChange} />
      <PageSection variant="default" key={currentSection}>
        <Title headingLevel="h1" className="pf-v6-u-mb-md">
          {getSectionTitle()}
        </Title>
        <div className="pf-v6-u-mt-md">{renderSection()}</div>
      </PageSection>
    </>
  );
};

export default ApiManagementPage;
