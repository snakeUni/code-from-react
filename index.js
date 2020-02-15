function isClass(type) {
  // React.Component subclasses have this flag
  return Boolean(type.prototype) && Boolean(type.prototype.isReactComponent);
}

// use class

function instantiateComponent() {
  const type = element.type;

  if (typeof type === "function") {
    // User-defined components
    return new CompositeComponent(element);
  } else if (typeof type === "string") {
    // Platform-specific components
    return new DOMComponent(element);
  }
}

class CompositeComponent {
  constructor(element) {
    this.currentElement = element;
    this.renderedComponent = null;
    this.publicInstance = null;
  }

  getPublicInstance() {
    // For composite components, expose the class instance.
    return this.publicInstance;
  }

  mount() {
    const element = this.currentElement;
    const type = element.type;
    const props = element.props;

    let publicInstance;
    let renderedElement;

    if (isClass(type)) {
      // Component class
      publicInstance = new type(props);
      // Set the props
      publicInstance.props = props;
      // Call the lifecycle if necessary
      if (publicInstance.componentWillMount) {
        publicInstance.componentWillMount();
      }
      // Get the rendered element by calling render()
      renderedElement = publicInstance.render();
    } else if (typeof type === "function") {
      // Component function
      publicInstance = null;
      renderedElement = type(props);
    }

    // Save the public instance
    this.publicInstance = publicInstance;

    // Instantiate the child internal instance according to the element.
    // It would be a DOMComponent for <div /> or <p />,
    // and a CompositeComponent for <App /> or <Button />:
    let renderedComponent = instantiateComponent(renderedElement);
    this.renderedComponent = renderedComponent;

    // Mount the rendered output
    return renderedComponent.mount();
  }

  unmount() {
    // Call the lifecycle method if necessary
    const publicInstance = this.publicInstance;
    if (publicInstance) {
      if (publicInstance.componentWillUnmount) {
        publicInstance.componentWillUnmount();
      }
    }

    // Unmount the single rendered component
    const renderedComponent = this.renderedComponent;
    renderedComponent.unmount();
  }

  receive(nextElement) {
    const preProps = this.currentElement.props;
    const publicInstance = this.publicInstance;
    const prevRenderedComponent = this.renderedComponent;
    const prevRenderedElement = prevRenderedComponent.currentElement;

    // Update *own* element
    this.currentElement = nextElement;
    const type = nextElement.type;
    const nextProps = nextElement.props;

    // Figure out what the next render() output is
    let nextRenderedElement;
    if (isClass(type)) {
      // Component class
      // Call the lifecycle if necessary
      if (publicInstance.componentWillUpdate) {
        publicInstance.componentWillUpdate(nextProps);
      }
      // Update the props
      publicInstance.props = nextProps;
      // Re-render
      nextRenderedElement = publicInstance.render();
    } else if (typeof type === "function") {
      nextRenderedElement = type(nextProps);
    }

    // If the rendered element type has not changed,
    // reuse the existing component instance and exit.
    if (prevRenderedElement.type === nextRenderedElement.type) {
      prevRenderedComponent.receive(nextRenderedElement);
      return;
    }

    // If we reached this point, we need to unmount the previously
    // mounted component, mount the new one, and swap their nodes.

    // Find the old node because it will need to be replaced
    const prevNode = prevRenderedComponent.getHostNode();

    // Unmount the old child and mount a new child
    prevRenderedComponent.unmount();
    const nextRenderedComponent = instantiateComponent(nextRenderedElement);
    const nextNode = nextRenderedComponent.mount();

    // Replace the reference to the child
    this.renderedComponent = nextRenderedComponent;

    // Replace the old node with the new one
    // Note: this is renderer-specific code and
    // ideally should live outside of CompositeComponent
    prevNode.parentNode.replaceChild(nextNode, prevNode);
  }

  getHostNode() {
    // Ask the rendered component to provide it.
    // This will recursively drill down any composites.
    return this.renderedComponent.getHostNode();
  }
}

class DOMComponent {
  constructor(element) {
    this.currentElement = element;
    this.renderedChildren = [];
    this.node = null;
  }

  getPublicInstance() {
    return this.node;
  }

  mount() {
    const element = this.currentElement;
    const type = element.type;
    const props = element.props;
    let children = props.children || [];

    if (!Array.isArray(children)) {
      children = [children];
    }

    // Create and save the node
    const node = document.createElement(type);
    this.node = node;

    // Set the attribute
    Object.keys(props).forEach(propName => {
      if (propName !== "children") {
        node.setAttribute(propName, props[propName]);
      }
    });

    // Create and save the contained children.
    // Each of them can be a DOMComponent or a CompositeComponent,
    // depending on whether the element type is a string or a function
    const renderedChildren = children.map(instantiateComponent);
    this.renderedChildren = renderedChildren;

    // Collect Dom and nodes they return on mount
    const childNodes = renderedChildren.map(child => child.mount());
    childNodes.forEach(childNode => node.appendChild(childNode));

    // Return the DOM node as mount result
    return node;
  }

  unmount() {
    // Unmount all the children
    const renderedChildren = this.renderedChildren;
    renderedChildren.forEach(child => child.unmount());
  }

  receive(nextElement) {
    const node = this.node;
    const prevElement = this.currentElement;
    const prevProps = prevElement.props;
    const nextProps = nextElement.props;
    this.currentElement = nextElement;

    // Remove old attributes.
    Object.keys(prevProps).forEach(propName => {
      if (propName !== "children" && !nextProps.hasOwnProperty(propName)) {
        node.removeAttribute(propName);
      }
    });
    // Set next attributes.
    Object.keys(nextProps).forEach(propName => {
      if (propName !== "children") {
        node.setAttribute(propName, nextProps[propName]);
      }
    });

    // These are arrays of React elements:
    const prevChildren = prevProps.children || [];
    if (!Array.isArray(prevChildren)) {
      prevChildren = [prevChildren];
    }

    const nextChildren = nextProps.children || [];
    if (!Array.isArray(nextChildren)) {
      nextChildren = [nextChildren];
    }
    // These are arrays of internal instances:
    const prevRenderedChildren = this.renderedChildren;
    const nextRenderedChildren = [];

    // As we iterate over children, we will add operations to the array.
    const operationQueue = [];

    // Note: the section below is extremely simplified!
    // It doesn't handle recorders, children with holes, or keys.
    // It only exists to illustrate the overall flow, not the specific.

    for (let i = 0; i < nextChildren.length; i++) {
      // Try to get an existing internal instance for this child
      const prevChild = prevRenderedChildren[i];

      // If there is no internal instance under this index,
      // a child has been appended to the end. Create a new
      // internal instance, mount it, and use its node.
      if (!prevChild) {
        const nextChild = instantiateComponent(nextChildren[i]);
        const node = nextChild.mount();

        // Record that we need to append a node
        operationQueue.push({ type: "ADD", node });
        nextRenderedChildren.push(nextChild);
        continue;
      }

      // We can only update the instance if its element's type matches.
      // For example, <Button size="small" /> can be updated to
      // <Button size="large" /> but not to an <App />
      const canUpdate = prevChildren[i].type === nextChildren[i].type;

      // If we can't update an existing instance, we have to unmount it
      // and mount a new one instead of it.
      if (!canUpdate) {
        const prevNode = prevChild.getHostNode();
        prevNode.unmount();

        const nextChild = instantiateComponent(nextChildren[i]);
        const nextNode = nextChild.mount();

        // Record that we need to swap the nodes
        operationQueue.push({ type: "REPLACE", prevNode, nextNode });
        nextRenderedChildren.push(nextChild);
        continue;
      }

      // If we can update an existing internal instance,
      // just let it receive the next element and handle its own update
      prevChild.receive(nextChildren[i]);
      nextRenderedChildren.push(prevChild);
    }

    // Finally unmount any children that don't exist:
    for (let j = nextChildren.length; j < prevChildren.length; j++) {
      const prevChild = prevChildren[j];
      const node = prevChild.getHostNode();
      prevChild.unmount();

      // Record that we need to remove the node
      operationQueue.push({ type: "REMOVE", node });
    }

    // Point the list of rendered children to the updated version.
    this.renderedChildren = nextRenderedChildren;

    // Process the operation queue.
    while (operationQueue.length > 0) {
      const operation = operationQueue.shift();
      switch (operation.type) {
        case "ADD": {
          this.node.appendChild(operation.node);
          break;
        }
        case "REPLACE": {
          this.node.replaceChild(operation.nextNode, operation.prevNode);
          break;
        }
        case "REMOVE": {
          this.node.removeChild(operation.node);
          break;
        }
      }
    }
  }

  getHostNode() {
    return this.node;
  }
}

function mountTree(element, containerNode) {
  // Destroy any existing tree
  if (containerNode.firstChild) {
    const prevNode = containerNode.firstChild;
    const prevRootComponent = prevNode._internalInstance;
    const prevElement = prevRootComponent.currentElement;

    // If we can, reuse the existing root component
    if (prevElement.type === element.type) {
      prevRootComponent.receive(element);
      return;
    }

    // Otherwise, unmount the existing tree
    unmountTree(containerNode);
  }

  // Create the top-level internal instance
  const rootComponent = instantiateComponent(element);

  // Mount the top-level component into the container
  const node = rootComponent.mount();
  containerNode.appendChild(node);

  // Save a reference to the internal instance
  node._internalInstance = rootComponent;

  // Return the public instance it provides
  const publicInstance = rootComponent.getPublicInstance();
  return publicInstance;
}

function unmountTree(containerNode) {
  // Read the internal instance from a DOM node
  // (This doesn't work yet, we will need to change mountTree() to store it.)
  const node = containerNode.firstChild;
  const rootComponent = node._internalInstance;

  // Unmount the tree and clear the container
  rootComponent.unmount();
  containerNode.innerHTML = "";
}

// run
const rootEl = document.getElementById("root");
mountTree(<App />, rootEl);
